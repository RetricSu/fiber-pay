import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFiberNode } from '../src/use-fiber-node.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubFetchAlwaysFailing() {
  const fetchMock = vi.fn(async () => {
    throw new Error('network unreachable');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubFetchDelayedWithAbort(delayMs: number, result: unknown) {
  const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({
          ok: true,
          status: 200,
          json: async () => ({ jsonrpc: '2.0', id: 1, result }),
        });
      }, delayMs);

      if (init?.signal) {
        init.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Fetch mock keyed by URL, resolved on demand via the returned `resolvers` map. */
function stubFetchByUrl() {
  const resolvers = new Map<string, (result: unknown) => void>();
  const fetchMock = vi.fn((url: string | URL) => {
    return new Promise((resolve) => {
      resolvers.set(String(url), (result) => {
        resolve({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });
      });
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, resolvers };
}

describe('useFiberNode', () => {
  it('reports ready and exposes nodeInfo once the remote node answers', async () => {
    stubFetchOnce({ jsonrpc: '2.0', id: 1, result: { version: '0.9.0', peers_count: '0x2' } });

    const { result } = renderHook(() => useFiberNode({ url: 'http://127.0.0.1:8227' }));

    expect(result.current.state).toBe('connecting');

    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });

    expect(result.current.isReady).toBe(true);
    expect(result.current.nodeInfo?.version).toBe('0.9.0');
    expect(result.current.error).toBeNull();
  });

  it('stays idle and does not call the node when disabled', async () => {
    const fetchMock = stubFetchOnce({ jsonrpc: '2.0', id: 1, result: { version: '0.9.0' } });

    const { result } = renderHook(() =>
      useFiberNode({ url: 'http://127.0.0.1:8227', enabled: false }),
    );

    expect(result.current.state).toBe('idle');
    expect(result.current.client).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a real error after maxRetries instead of retrying forever silently', async () => {
    stubFetchAlwaysFailing();

    const { result } = renderHook(() =>
      useFiberNode({ url: 'http://127.0.0.1:8227', pollIntervalMs: 1, maxRetries: 2 }),
    );

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error).toBe('network unreachable');
    expect(result.current.isReady).toBe(false);
  });

  it('does not let a stale run overwrite the latest run after the url changes', async () => {
    const { resolvers } = stubFetchByUrl();

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useFiberNode({ url }),
      { initialProps: { url: 'http://node-a' } },
    );

    expect(result.current.state).toBe('connecting');

    rerender({ url: 'http://node-b' });

    await act(async () => {
      resolvers.get('http://node-b')?.({ version: 'B' });
    });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.nodeInfo?.version).toBe('B');

    // The abandoned request for node-a finally comes back. It must not
    // clobber node-b's already-committed state.
    await act(async () => {
      resolvers.get('http://node-a')?.({ version: 'A' });
    });

    expect(result.current.nodeInfo?.version).toBe('B');
    expect(result.current.state).toBe('ready');
  });

  it('succeeds on delayed response when timeout is omitted (default SDK timeout preserved)', async () => {
    stubFetchDelayedWithAbort(30, { version: '0.9.0' });

    const { result } = renderHook(() =>
      useFiberNode({ url: 'http://127.0.0.1:8227', maxRetries: 1 }),
    );

    expect(result.current.state).toBe('connecting');
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.nodeInfo?.version).toBe('0.9.0');
  });

  it('aborts and reports error when response exceeds explicit timeout', async () => {
    stubFetchDelayedWithAbort(50, { version: '0.9.0' });

    const { result } = renderHook(() =>
      useFiberNode({ url: 'http://127.0.0.1:8227', timeout: 10, maxRetries: 1 }),
    );

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error).toBe('Request timeout');
  });

  it('does not recreate client or reconnect when inline headers have identical content', async () => {
    const fetchMock = stubFetchOnce({ jsonrpc: '2.0', id: 1, result: { version: '0.9.0' } });

    const { result, rerender } = renderHook(
      ({ headers }: { headers: Record<string, string> }) =>
        useFiberNode({ url: 'http://127.0.0.1:8227', headers }),
      { initialProps: { headers: { Authorization: 'Bearer token-1' } } },
    );

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstClient = result.current.client;

    // Re-render with a new object instance but identical content
    rerender({ headers: { Authorization: 'Bearer token-1' } });

    expect(result.current.client).toBe(firstClient);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reconnects and creates a new client when header values change', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { version: '0.9.0' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ headers }: { headers: Record<string, string> }) =>
        useFiberNode({ url: 'http://127.0.0.1:8227', headers }),
      { initialProps: { headers: { Authorization: 'Bearer token-1' } } },
    );

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstClient = result.current.client;

    rerender({ headers: { Authorization: 'Bearer token-2' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.client).not.toBe(firstClient);
  });
});
