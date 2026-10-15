import { cleanup, renderHook, waitFor } from '@testing-library/react';
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
});
