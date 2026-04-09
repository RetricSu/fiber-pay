import {
  BrowserRpcClient,
  type BrowserRpcClientConfig,
  FiberRpcClient,
  FiberRpcError,
} from '../src/browser/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Browser RPC client exports', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should export BrowserRpcClient as FiberRpcClient-compatible alias', () => {
    expect(BrowserRpcClient).toBe(FiberRpcClient);
  });

  it('should call node_info via browser entry client', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          node_name: 'browser-node',
        },
      }),
    });
    globalThis.fetch = fetchMock;

    const config: BrowserRpcClientConfig = { url: 'http://127.0.0.1:8227' };
    const client = new BrowserRpcClient(config);
    await client.nodeInfo();

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    expect(body.method).toBe('node_info');
    expect(body.params).toEqual([]);
  });

  it('should throw FiberRpcError on JSON-RPC error responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32010,
          message: 'permission denied',
        },
      }),
    });
    globalThis.fetch = fetchMock;

    const client = new BrowserRpcClient({ url: 'http://127.0.0.1:8227' });

    await expect(client.nodeInfo()).rejects.toBeInstanceOf(FiberRpcError);
    await expect(client.nodeInfo()).rejects.toMatchObject({
      code: -32010,
      message: 'permission denied',
    });
  });
});
