import { FiberRpcClient } from '@fiber-pay/sdk';
import type { CliConfig } from './config.js';
import { isProcessRunning } from './pid.js';
import { readRuntimeMeta, readRuntimePid } from './runtime-meta.js';

export type ResolvedRpcTarget = 'node-rpc' | 'runtime-proxy';

export interface ResolvedRpcEndpoint {
  url: string;
  target: ResolvedRpcTarget;
}

function normalizeUrl(url: string): string {
  try {
    const normalized = new URL(url).toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return url.endsWith('/') ? url.slice(0, -1) : url;
  }
}

function resolveRuntimeProxyUrl(config: CliConfig): string | undefined {
  const runtimeMeta = readRuntimeMeta(config.dataDir);
  const runtimePid = readRuntimePid(config.dataDir);

  if (!runtimeMeta || !runtimePid || !isProcessRunning(runtimePid)) {
    return undefined;
  }

  if (!runtimeMeta.proxyListen || !runtimeMeta.fiberRpcUrl) {
    return undefined;
  }

  if (normalizeUrl(runtimeMeta.fiberRpcUrl) !== normalizeUrl(config.rpcUrl)) {
    return undefined;
  }

  if (
    runtimeMeta.proxyListen.startsWith('http://') ||
    runtimeMeta.proxyListen.startsWith('https://')
  ) {
    return runtimeMeta.proxyListen;
  }

  return `http://${runtimeMeta.proxyListen}`;
}

export function createRpcClient(config: CliConfig): FiberRpcClient {
  const resolved = resolveRpcEndpoint(config);
  return new FiberRpcClient({
    url: resolved.url,
    biscuitToken: config.rpcBiscuitToken,
  });
}

export function resolveRpcEndpoint(config: CliConfig): ResolvedRpcEndpoint {
  const runtimeProxyUrl = resolveRuntimeProxyUrl(config);
  if (runtimeProxyUrl) {
    return {
      url: runtimeProxyUrl,
      target: 'runtime-proxy',
    };
  }

  return {
    url: config.rpcUrl,
    target: 'node-rpc',
  };
}

export async function createReadyRpcClient(
  config: CliConfig,
  options: { timeout?: number; interval?: number } = {},
): Promise<FiberRpcClient> {
  const rpc = createRpcClient(config);
  await rpc.waitForReady({ timeout: options.timeout ?? 3000, interval: options.interval ?? 500 });
  return rpc;
}
