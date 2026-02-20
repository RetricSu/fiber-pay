import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseListenAddress } from '../config.js';
import { isPayloadTooLargeError, readRawBody } from './body.js';
import { CORS_HEADERS, CORS_PREFLIGHT_HEADERS, writeJson } from './http-utils.js';
import { collectJsonRpcMethods, captureTrackedHashes } from './jsonrpc-tracking.js';
import { tryParseJson } from './json.js';
import { handleJobPostEndpoint, handleDeleteEndpoint } from './job-routes.js';
import { handleMonitorEndpoint } from './monitor-routes.js';
import type { RpcMonitorProxyConfig, RpcMonitorProxyDeps } from './types.js';

export type { RpcMonitorProxyConfig, RpcMonitorProxyDeps, RpcMonitorProxyStatus } from './types.js';

export class RpcMonitorProxy {
  private readonly config: RpcMonitorProxyConfig;
  private readonly deps: RpcMonitorProxyDeps;
  private server: http.Server | undefined;

  constructor(config: RpcMonitorProxyConfig, deps: RpcMonitorProxyDeps) {
    this.config = config;
    this.deps = deps;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    assertNoProxySelfLoop(this.config.listen, this.config.targetUrl);

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    const { host, port } = parseListenAddress(this.config.listen);

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, host, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_PREFLIGHT_HEADERS);
      res.end();
      return;
    }

    if (req.method === 'GET') {
      handleMonitorEndpoint(req, res, this.deps);
      return;
    }

    if (req.method === 'DELETE') {
      await handleDeleteEndpoint(req, res, this.deps);
      return;
    }

    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/jobs/')) {
      await handleJobPostEndpoint(url.pathname, req, res, this.deps);
      return;
    }

    let requestBody: Buffer;
    try {
      requestBody = await readRawBody(req);
    } catch (error) {
      if (isPayloadTooLargeError(error)) {
        writeJson(res, 413, { error: 'Request body too large' });
        return;
      }
      writeJson(res, 400, { error: 'Failed to read request body' });
      return;
    }

    const requestJson = tryParseJson(requestBody.toString('utf-8'));
    const methodById = collectJsonRpcMethods(requestJson);

    let responseText = '';
    let responseStatus = 500;
    let responseHeaders = new Headers();

    try {
      const response = await fetch(this.config.targetUrl, {
        method: 'POST',
        headers: {
          'content-type': req.headers['content-type'] ?? 'application/json',
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        },
        body: requestBody,
      });

      responseStatus = response.status;
      responseHeaders = response.headers;
      responseText = await response.text();

      const responseJson = tryParseJson(responseText);
      captureTrackedHashes(methodById, responseJson, {
        onInvoiceTracked: this.deps.onInvoiceTracked,
        onPaymentTracked: this.deps.onPaymentTracked,
      });
    } catch (error) {
      writeJson(res, 502, { error: `Proxy request failed: ${String(error)}` });
      return;
    }

    const contentType = responseHeaders.get('content-type') ?? 'application/json';
    res.writeHead(responseStatus, {
      'content-type': contentType,
      ...CORS_HEADERS,
    });
    res.end(responseText);
  }
}

function assertNoProxySelfLoop(listen: string, targetUrl: string): void {
  const { host, port } = parseListenAddress(listen);

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error(`Invalid proxy targetUrl: ${targetUrl}`);
  }

  const targetHost = normalizeHost(parsed.hostname);
  const listenHost = normalizeHost(host);
  const targetPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');

  if (targetHost === listenHost && targetPort === String(port)) {
    throw new Error(
      `Invalid proxy configuration: targetUrl (${targetUrl}) points to proxy listen address (${listen})`,
    );
  }
}

function normalizeHost(host: string): string {
  if (host === 'localhost' || host === '::1') {
    return '127.0.0.1';
  }
  return host;
}
