/**
 * Agent Proxy — Host-side HTTP proxy for BoxLite containers
 *
 * Provides two security layers for `agent serve`:
 *
 * 1. **API-key shim (reverse proxy)**: The container never sees the real
 *    API keys.  Instead it is given fake placeholder keys and
 *    `*_BASE_URL` env vars that point to local reverse-proxy routes
 *    (e.g. `/anthropic/*`, `/openai/*`).  When a request arrives the
 *    proxy strips the fake auth header and injects the real one before
 *    forwarding to the upstream provider over HTTPS.
 *
 * 2. **Network deny-list (forward proxy / CONNECT tunnel)**: The container
 *    sets `HTTP_PROXY` / `HTTPS_PROXY` to this proxy.  Every `CONNECT`
 *    request is resolved to an IP and checked against a hard-coded
 *    deny-list of private / loopback / link-local CIDRs.  Denied
 *    destinations receive a `403` response; all other traffic is
 *    tunnelled transparently.
 */

import { lookup } from 'node:dns/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { Readable } from 'node:stream';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentProxyOptions {
  /** Port the proxy listens on. */
  port: number;
  /** Host/IP the proxy binds to (default: auto-detected hostAddr or `127.0.0.1`). */
  host?: string;
  /**
   * Address that the **container** uses to reach this proxy.
   * If omitted, auto-detected via `detectHostAddress()`.
   */
  hostAddr?: string;
  /** Real API keys to inject upstream (key = provider name). */
  apiKeys: {
    anthropic?: string;
    openai?: string;
    kimi?: string;
  };
}

export interface ProxyEnv {
  /** Environment variables to pass into the container. */
  env: Record<string, string>;
  /** The proxy URL as seen from the container. */
  proxyUrl: string;
}

// ---------------------------------------------------------------------------
// CIDR deny-list
// ---------------------------------------------------------------------------

interface CidrEntry {
  /** Numeric representation of the network address. */
  addr: bigint;
  /** Bitmask with `prefix` leading 1-bits. */
  mask: bigint;
}

const IPV4_MAX = 0xffffffffn;

function parseIpv4ToBigInt(ip: string): bigint | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let result = 0n;
  for (const part of parts) {
    const n = Number(part);
    if (Number.isNaN(n) || n < 0 || n > 255) return undefined;
    result = (result << 8n) | BigInt(n);
  }
  return result;
}

function parseCidr(cidr: string): CidrEntry | undefined {
  const [ipPart, prefixPart] = cidr.split('/');
  if (!ipPart || !prefixPart) return undefined;
  const prefix = Number(prefixPart);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return undefined;
  const addr = parseIpv4ToBigInt(ipPart);
  if (addr === undefined) return undefined;
  const mask = prefix === 0 ? 0n : (IPV4_MAX << BigInt(32 - prefix)) & IPV4_MAX;
  return { addr: addr & mask, mask };
}

const DENIED_CIDRS_RAW = [
  '127.0.0.0/8', // loopback
  '10.0.0.0/8', // RFC-1918 private
  '172.16.0.0/12', // RFC-1918 private
  '192.168.0.0/16', // RFC-1918 private
  '169.254.0.0/16', // link-local
  '0.0.0.0/8', // "this" network
];

const DENIED_CIDRS: CidrEntry[] = DENIED_CIDRS_RAW.map(parseCidr).filter(
  (entry): entry is CidrEntry => entry !== undefined,
);

/**
 * Parse an IPv6 address into a 128-bit bigint.
 * Handles compressed (`::`) and IPv4-mapped (`::ffff:1.2.3.4`) forms.
 */
function parseIpv6ToBigInt(ip: string): bigint | undefined {
  // Handle IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1)
  const v4MappedMatch = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4MappedMatch) {
    const v4 = parseIpv4ToBigInt(v4MappedMatch[1]);
    if (v4 === undefined) return undefined;
    return (0xffffn << 32n) | v4;
  }

  // Expand :: notation
  const halves = ip.split('::');
  if (halves.length > 2) return undefined;

  let groups: string[];
  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return undefined;
    groups = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    groups = ip.split(':');
  }

  if (groups.length !== 8) return undefined;

  let result = 0n;
  for (const group of groups) {
    const n = parseInt(group, 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return undefined;
    result = (result << 16n) | BigInt(n);
  }
  return result;
}

/** IPv6 CIDR ranges to deny. */
interface Ipv6CidrEntry {
  addr: bigint;
  mask: bigint;
}

const IPV6_MAX = (1n << 128n) - 1n;

function parseIpv6Cidr(cidr: string): Ipv6CidrEntry | undefined {
  const [ipPart, prefixPart] = cidr.split('/');
  if (!ipPart || !prefixPart) return undefined;
  const prefix = Number(prefixPart);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 128) return undefined;
  const addr = parseIpv6ToBigInt(ipPart);
  if (addr === undefined) return undefined;
  const mask = prefix === 0 ? 0n : (IPV6_MAX << BigInt(128 - prefix)) & IPV6_MAX;
  return { addr: addr & mask, mask };
}

const DENIED_IPV6_CIDRS_RAW = [
  '::1/128', // loopback
  'fc00::/7', // unique local
  'fe80::/10', // link-local
  '::ffff:127.0.0.0/104', // IPv4-mapped loopback  — handled via v4 check
  '::ffff:10.0.0.0/104', // IPv4-mapped RFC-1918  — handled via v4 check
  '::ffff:172.16.0.0/108', // IPv4-mapped RFC-1918  — handled via v4 check
  '::ffff:192.168.0.0/112', // IPv4-mapped RFC-1918  — handled via v4 check
  '::ffff:169.254.0.0/112', // IPv4-mapped link-local — handled via v4 check
  '::ffff:0.0.0.0/104', // IPv4-mapped "this" network
];

const DENIED_IPV6_CIDRS: Ipv6CidrEntry[] = DENIED_IPV6_CIDRS_RAW.map(parseIpv6Cidr).filter(
  (entry): entry is Ipv6CidrEntry => entry !== undefined,
);

/**
 * Check whether an IP address string falls within the deny-list.
 * Supports both IPv4, IPv6, and IPv4-mapped IPv6 addresses.
 */
export function isDeniedAddress(ip: string): boolean {
  // Handle IPv4-mapped IPv6 — extract the embedded v4 address and check it.
  const v4MappedMatch = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4MappedMatch) {
    return isDeniedAddress(v4MappedMatch[1]);
  }

  // IPv6 check
  if (ip.includes(':')) {
    const addr = parseIpv6ToBigInt(ip);
    if (addr === undefined) return false;
    for (const cidr of DENIED_IPV6_CIDRS) {
      if ((addr & cidr.mask) === cidr.addr) return true;
    }
    return false;
  }

  // IPv4 CIDR check
  const addr = parseIpv4ToBigInt(ip);
  if (addr === undefined) return false;
  for (const cidr of DENIED_CIDRS) {
    if ((addr & cidr.mask) === cidr.addr) return true;
  }
  return false;
}

/**
 * DNS-resolve a hostname and check whether **any** of its addresses
 * fall within the deny-list. Returns the first allowed resolved IP
 * if any, or `null` if all are denied or DNS fails.
 *
 * Uses `{ all: true }` to resolve all A/AAAA records and denies
 * if **any** resolved address is in the deny-list (fail-closed).
 *
 * @returns The first allowed IP address, or `null` if denied / unresolvable.
 */
export async function resolveAllAndCheck(hostname: string): Promise<string | null> {
  // If the hostname is already a raw IP, check directly.
  if (isDeniedAddress(hostname)) return null;
  // If it's a raw IP that's allowed, return it as-is.
  if (parseIpv4ToBigInt(hostname) !== undefined || hostname.includes(':')) {
    return hostname;
  }

  try {
    const results = await lookup(hostname, { all: true });
    // Deny if ANY resolved address is in the deny-list (fail-closed).
    for (const result of results) {
      if (isDeniedAddress(result.address)) return null;
    }
    // Return the first resolved address to connect to (avoids TOCTOU).
    return results.length > 0 ? results[0].address : null;
  } catch {
    // DNS failure — deny by default (fail-closed).
    return null;
  }
}

/**
 * @deprecated Use `resolveAllAndCheck` instead. Kept for backward compatibility.
 */
export async function resolveAndCheckDenied(hostname: string): Promise<boolean> {
  return (await resolveAllAndCheck(hostname)) === null;
}

// ---------------------------------------------------------------------------
// Host address detection
// ---------------------------------------------------------------------------

/**
 * Auto-detect the first non-loopback IPv4 address on this host.
 * Used as the default value for the proxy URL that the container sees.
 */
export function detectHostAddress(): string {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const addrs = ifaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  // Fallback — unlikely but safe.
  return '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Reverse proxy helpers
// ---------------------------------------------------------------------------

/** Copy select headers from the incoming request, stripping hop-by-hop. */
function forwardHeaders(
  req: IncomingMessage,
  overrides: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'host',
  ]);
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  // Remove auth headers that carry fake keys.
  delete headers['authorization'];
  delete headers['x-api-key'];
  // Apply overrides (real auth headers).
  Object.assign(headers, overrides);
  return headers;
}

// ---------------------------------------------------------------------------
// AgentProxy class
// ---------------------------------------------------------------------------

export const SHIM_PLACEHOLDER = 'fp-shim-placeholder';

export class AgentProxy {
  private server: Server | null = null;
  private readonly options: Required<AgentProxyOptions>;
  /** Actual port the server is listening on (differs from options.port when port=0). */
  private boundPort = 0;

  constructor(options: AgentProxyOptions) {
    const hostAddr = options.hostAddr || detectHostAddress();
    this.options = {
      // Bind to the detected host address by default, not 0.0.0.0,
      // to avoid exposing an open proxy on all interfaces.
      host: options.host || hostAddr,
      hostAddr,
      ...options,
    };
  }

  /** The actual port the proxy is listening on. Equals `options.port` unless port 0 was used. */
  get listeningPort(): number {
    return this.boundPort || this.options.port;
  }

  /** The URL the container should use to reach this proxy. */
  get proxyUrl(): string {
    return `http://${this.options.hostAddr}:${this.listeningPort}`;
  }

  /**
   * Build the environment variables to inject into the container.
   *
   * - Fake API keys (placeholder values)
   * - `*_BASE_URL` pointing to local reverse proxy routes
   * - `HTTP_PROXY` / `HTTPS_PROXY` for CONNECT tunnelling
   */
  buildContainerEnv(): Record<string, string> {
    const base = this.proxyUrl;
    const env: Record<string, string> = {
      HOME: '/home/boxlite',
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HTTP_PROXY: base,
      HTTPS_PROXY: base,
      // Ensure the proxy itself is not proxied (avoid loops).
      NO_PROXY: this.options.hostAddr,
    };

    if (this.options.apiKeys.anthropic) {
      env.ANTHROPIC_API_KEY = SHIM_PLACEHOLDER;
      env.ANTHROPIC_BASE_URL = `${base}/anthropic`;
    }

    if (this.options.apiKeys.openai) {
      env.OPENAI_API_KEY = SHIM_PLACEHOLDER;
      env.OPENAI_BASE_URL = `${base}/openai`;
    }

    if (this.options.apiKeys.kimi) {
      env.KIMI_API_KEY = SHIM_PLACEHOLDER;
      env.KIMI_BASE_URL = `${base}/kimi`;
    }

    return env;
  }

  /**
   * Build the OpenCode `opencode.json` config content for BASE_URL override.
   * OpenCode does not read `*_BASE_URL` from env vars — it requires a config file.
   */
  buildOpenCodeConfig(): string {
    const base = this.proxyUrl;

    interface ProviderEntry {
      options: { baseURL: string };
    }
    const providers: Record<string, ProviderEntry> = {};

    if (this.options.apiKeys.anthropic) {
      providers.anthropic = { options: { baseURL: `${base}/anthropic` } };
    }
    if (this.options.apiKeys.openai) {
      providers.openai = { options: { baseURL: `${base}/openai` } };
    }
    if (this.options.apiKeys.kimi) {
      providers['kimi-for-coding'] = { options: { baseURL: `${base}/kimi` } };
    }

    return JSON.stringify({ provider: providers }, null, 2);
  }

  // -----------------------------------------------------------------------
  // Server lifecycle
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.server) return;

    const server = createServer((req, res) => this.handleRequest(req, res));

    // Handle CONNECT tunnels (forward proxy).
    server.on('connect', (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
      this.handleConnect(req, clientSocket, head);
    });

    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(this.options.port, this.options.host, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.boundPort = addr.port;
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    // Force-close active CONNECT tunnels so the server doesn't hang.
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  // -----------------------------------------------------------------------
  // HTTP request handler (reverse proxy routes)
  // -----------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '/';

    // Health check
    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Anthropic reverse proxy
    if (url.startsWith('/anthropic/') || url === '/anthropic') {
      await this.reverseProxy(req, res, {
        upstream: 'https://api.anthropic.com',
        pathPrefix: '/anthropic',
        authHeader: this.options.apiKeys.anthropic
          ? { 'x-api-key': this.options.apiKeys.anthropic }
          : {},
      });
      return;
    }

    // OpenAI reverse proxy
    if (url.startsWith('/openai/') || url === '/openai') {
      await this.reverseProxy(req, res, {
        upstream: 'https://api.openai.com',
        pathPrefix: '/openai',
        authHeader: this.options.apiKeys.openai
          ? { Authorization: `Bearer ${this.options.apiKeys.openai}` }
          : {},
      });
      return;
    }

    // Kimi reverse proxy
    if (url.startsWith('/kimi/') || url === '/kimi') {
      await this.reverseProxy(req, res, {
        upstream: 'https://api.kimi.com/coding/v1',
        pathPrefix: '/kimi',
        authHeader: this.options.apiKeys.kimi
          ? { Authorization: `Bearer ${this.options.apiKeys.kimi}` }
          : {},
      });
      return;
    }

    // Unknown route
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private async reverseProxy(
    req: IncomingMessage,
    res: ServerResponse,
    config: {
      upstream: string;
      pathPrefix: string;
      authHeader: Record<string, string>;
    },
  ): Promise<void> {
    const url = req.url || '/';
    const upstreamPath = url.startsWith(config.pathPrefix)
      ? url.slice(config.pathPrefix.length) || '/'
      : url;
    const upstreamUrl = `${config.upstream}${upstreamPath}`;

    try {
      const headers = forwardHeaders(req, config.authHeader);
      const isBodyless = ['GET', 'HEAD'].includes(req.method || '');

      // Stream the request body directly instead of buffering it entirely.
      const body = isBodyless ? undefined : (Readable.toWeb(req) as ReadableStream);

      const upstreamResponse = await fetch(upstreamUrl, {
        method: req.method || 'POST',
        headers,
        body,
        duplex: isBodyless ? undefined : 'half',
      });

      // Stream the response back.
      const responseHeaders: Record<string, string> = {};
      upstreamResponse.headers.forEach((value, key) => {
        // Skip hop-by-hop headers from upstream.
        if (!['transfer-encoding', 'connection', 'keep-alive'].includes(key.toLowerCase())) {
          responseHeaders[key] = value;
        }
      });

      res.writeHead(upstreamResponse.status, responseHeaders);

      if (upstreamResponse.body) {
        // Pipe the upstream response through a Node Readable to handle backpressure.
        const nodeStream = Readable.fromWeb(
          upstreamResponse.body as import('stream/web').ReadableStream,
        );
        nodeStream.pipe(res);
        await new Promise<void>((resolve, reject) => {
          nodeStream.on('end', resolve);
          nodeStream.on('error', reject);
          res.on('error', () => nodeStream.destroy());
        });
      } else {
        res.end();
      }
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Upstream request failed',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // CONNECT tunnel handler (forward proxy with deny-list)
  // -----------------------------------------------------------------------

  private async handleConnect(
    req: IncomingMessage,
    clientSocket: Socket,
    head: Buffer,
  ): Promise<void> {
    const target = req.url || '';
    const colonIdx = target.lastIndexOf(':');
    const hostname = colonIdx > 0 ? target.slice(0, colonIdx) : target;
    const port = colonIdx > 0 ? Number(target.slice(colonIdx + 1)) : 443;

    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      clientSocket.destroy();
      return;
    }

    // Resolve DNS once and use the resolved IP for both the deny-list
    // check and the actual connection to prevent TOCTOU / DNS rebinding.
    const resolvedIp = await resolveAllAndCheck(hostname);
    if (!resolvedIp) {
      clientSocket.write(
        'HTTP/1.1 403 Forbidden\r\n' +
          'Content-Type: text/plain\r\n' +
          '\r\n' +
          `Connection to ${hostname} is denied by network policy.\n`,
      );
      clientSocket.destroy();
      return;
    }

    // Track whether we've sent the 200 response.
    let tunnelEstablished = false;

    // Establish tunnel to the resolved IP (not the hostname) to
    // prevent a second DNS resolution from yielding a different address.
    const serverSocket = connect(port, resolvedIp, () => {
      tunnelEstablished = true;
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        serverSocket.write(head);
      }
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', () => {
      // Only send an error response if we haven't sent 200 yet.
      if (!tunnelEstablished) {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      }
      clientSocket.destroy();
    });

    clientSocket.on('error', () => {
      serverSocket.destroy();
    });
  }
}
