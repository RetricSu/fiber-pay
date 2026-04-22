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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentProxyOptions {
  /** Port the proxy listens on. */
  port: number;
  /** Host/IP the proxy binds to (default `0.0.0.0`). */
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

/** IPv6 addresses that are always denied. */
const DENIED_IPV6_PREFIXES = [
  '::1', // loopback
  'fc', // unique local (fc00::/7)
  'fd', // unique local (fc00::/7)
  'fe80:', // link-local (fe80::/10)
];

/**
 * Check whether an IP address string falls within the deny-list.
 * Supports both IPv4 and IPv6.
 */
export function isDeniedAddress(ip: string): boolean {
  // IPv6 check (simple prefix match — sufficient for loopback/ULA/link-local)
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;
    for (const prefix of DENIED_IPV6_PREFIXES) {
      if (lower.startsWith(prefix)) return true;
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
 * fall within the deny-list.
 *
 * @returns `true` if the hostname resolves to a denied address.
 */
export async function resolveAndCheckDenied(hostname: string): Promise<boolean> {
  // If the hostname is already a raw IP, skip DNS.
  if (isDeniedAddress(hostname)) return true;

  try {
    const { address } = await lookup(hostname);
    return isDeniedAddress(address);
  } catch {
    // DNS failure — deny by default (fail-closed).
    return true;
  }
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

/** Pipe an incoming Node request body to an outgoing fetch-style request. */
async function collectBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

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
    this.options = {
      host: '0.0.0.0',
      hostAddr: options.hostAddr || detectHostAddress(),
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
      const body = await collectBody(req);
      const headers = forwardHeaders(req, config.authHeader);

      const upstreamResponse = await fetch(upstreamUrl, {
        method: req.method || 'POST',
        headers,
        body: ['GET', 'HEAD'].includes(req.method || '') ? undefined : body,
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
        const reader = (upstreamResponse.body as ReadableStream<Uint8Array>).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
        } catch {
          // Client may have disconnected.
        } finally {
          reader.releaseLock();
        }
      }

      res.end();
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

    // Deny-list check.
    const denied = await resolveAndCheckDenied(hostname);
    if (denied) {
      clientSocket.write(
        'HTTP/1.1 403 Forbidden\r\n' +
          'Content-Type: text/plain\r\n' +
          '\r\n' +
          `Connection to ${hostname} is denied by network policy.\n`,
      );
      clientSocket.destroy();
      return;
    }

    // Establish tunnel.
    const serverSocket = connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        serverSocket.write(head);
      }
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', () => {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.destroy();
    });

    clientSocket.on('error', () => {
      serverSocket.destroy();
    });
  }
}
