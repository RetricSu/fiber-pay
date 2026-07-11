import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeInfoPanel } from '../src/node-info-panel.js';

const validUdtScript = {
  code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
  hash_type: 'type' as const,
  args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
};

function createNodeMock() {
  return {
    nodeInfo: vi.fn(async () => ({
      pubkey: '0x0123456789abcdef',
      default_funding_lock_script: {
        code_hash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bb3c0d5d5',
        hash_type: 'type' as const,
        args: '0x1234',
      },
    })),
    listPeers: vi.fn(async () => ({ peers: [] })),
    listChannels: vi.fn(async () => ({ channels: [] })),
    state: 'running' as const,
  };
}

Object.assign(globalThis.navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NodeInfoPanel', () => {
  it('displays UDT balance when asset is UDT', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn(async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          objects: [
            {
              output: { capacity: '0x0' },
              output_data: '0x10270000000000000000000000000000',
            },
          ],
          last_cursor: '0x',
        },
      })),
    } as unknown as Response);

    const node = createNodeMock();
    render(
      <NodeInfoPanel
        node={node as never}
        network="testnet"
        asset={{ kind: 'udt', script: validUdtScript, name: 'RUSD' }}
        pollInterval={60000}
        showQrCode
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/10000/)).toBeTruthy();
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(screen.getByText(/Address only/).textContent).toContain('select RUSD');
  });

  it('falls back to generic UDT label when name is not provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn(async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          objects: [],
          last_cursor: '0x',
        },
      })),
    } as unknown as Response);

    const node = createNodeMock();
    render(
      <NodeInfoPanel
        node={node as never}
        network="testnet"
        asset={{ kind: 'udt', script: validUdtScript }}
        pollInterval={60000}
        showQrCode
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/0 UDT/)).toBeTruthy();
    });

    expect(screen.getByText(/Address only/).textContent).toContain('select UDT');
  });
});
