import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FiberNodeButton } from '../src/fiber-node-button.js';
import type { UseFiberNodeResult } from '../src/use-fiber-node.js';

afterEach(() => {
  cleanup();
});

function createNodeMock() {
  return {
    listPeers: vi.fn(async () => ({ peers: [{ pubkey: '0xabc' }] })),
    listChannels: vi.fn(async () => ({ channels: [] })),
    graphNodes: vi.fn(async () => ({ nodes: [], last_cursor: '0x0' })),
    graphChannels: vi.fn(async () => ({ channels: [], last_cursor: '0x0' })),
    connectPeer: vi.fn(async () => ({})),
    shutdownChannel: vi.fn(async () => ({})),
    abandonChannel: vi.fn(async () => ({})),
    newInvoice: vi.fn(async () => ({ invoice_address: 'ln-fake-invoice' })),
    parseInvoice: vi.fn(async () => ({ invoice: { data: { payment_hash: '0x1' } } })),
    sendPayment: vi.fn(async () => ({})),
    waitForPayment: vi.fn(async () => ({ status: 'Succeeded' })),
  };
}

function createFiberMock(overrides: Partial<UseFiberNodeResult> = {}): UseFiberNodeResult {
  return {
    state: 'idle',
    node: null,
    nodeInfo: null,
    error: null,
    isStarting: false,
    isRunning: false,
    isPasskeySupported: true,
    passkeySupportReason: 'supported',
    passkeyUnavailableReason: null,
    hasPasskeyConfigured: true,
    startWithPassword: vi.fn(async () => {}),
    createPasskeyAndStart: vi.fn(async () => {}),
    startWithPasskey: vi.fn(async () => {}),
    startWithRawKey: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('FiberNodeButton extensibility', () => {
  it('keeps default tab behavior when no extension props are passed', async () => {
    const node = createNodeMock();
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    render(<FiberNodeButton fiber={fiber} strategy="passkey" />);

    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));

    expect(screen.getByRole('tab', { name: 'Workbench' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Channels' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Diagnostics' })).toBeTruthy();

    await waitFor(() => {
      expect(node.listPeers).toHaveBeenCalled();
    });
  });

  it('supports tabs config, renderTabContent, renderAction and i18n t', async () => {
    const node = createNodeMock();
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    const t = (key: string, fallback: string) => {
      const dictionary: Record<string, string> = {
        'tabs.workbench': '操作台',
        'tabs.channels': '通道',
      };
      return dictionary[key] ?? fallback;
    };

    let sawRenderActionState = false;

    render(
      <FiberNodeButton
        fiber={fiber}
        strategy="passkey"
        t={t}
        tabs={[
          { id: 'channels' },
          {
            id: 'my-stats',
            label: 'My Stats',
            render: () => <div>Stats Tab Body</div>,
          },
          { id: 'diagnostics', hidden: true },
          { id: 'workbench' },
        ]}
        renderTabContent={(tabId) => {
          if (tabId !== 'channels') {
            return undefined;
          }
          return <div>Custom Channels Content</div>;
        }}
        renderAction={({ id, defaultProps, state }) => {
          if (state.activeTab !== undefined && state.paymentResult !== undefined) {
            sawRenderActionState = true;
          }

          if (id !== 'pay-invoice') {
            return undefined;
          }

          return (
            <button
              type="button"
              disabled={defaultProps.disabled}
              onClick={() => {
                void defaultProps.onTrigger();
              }}
            >
              {defaultProps.loading ? 'Paying Custom...' : 'Pay Invoice Custom'}
            </button>
          );
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));

    expect(screen.getByRole('tab', { name: '通道' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'My Stats' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '操作台' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Diagnostics' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '通道' }));
    expect(screen.getByText('Custom Channels Content')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'My Stats' }));
    expect(screen.getByText('Stats Tab Body')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '操作台' }));
    expect(screen.getByRole('button', { name: 'Pay Invoice Custom' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay Invoice' })).toBeNull();
    expect(sawRenderActionState).toBe(true);
  });

  it('allows tabs.render to override built-in tab content', async () => {
    const node = createNodeMock();
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    render(
      <FiberNodeButton
        fiber={fiber}
        strategy="passkey"
        tabs={[
          { id: 'workbench' },
          { id: 'channels', render: () => <div>Channels Overridden By tabs.render</div> },
          { id: 'diagnostics' },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));

    expect(screen.getByText('Channels Overridden By tabs.render')).toBeTruthy();
  });

  it('shows empty-tab notice when all configured tabs are hidden', async () => {
    const node = createNodeMock();
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    render(
      <FiberNodeButton
        fiber={fiber}
        strategy="passkey"
        tabs={[
          { id: 'workbench', hidden: true },
          { id: 'channels', hidden: true },
          { id: 'diagnostics', hidden: true },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));

    expect(screen.getByText('No visible tabs are configured.')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});
