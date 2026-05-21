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
    connectPeer: vi.fn(async () => ({})),
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

describe('FiberNodeButton', () => {
  it('renders as a connect button when disconnected', () => {
    const fiber = createFiberMock();

    render(<FiberNodeButton fiber={fiber} strategy="password" password="secret" />);

    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('shows connection/channel/payment sections in dropdown when connected', async () => {
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
        renderConnectorSection={() => <div>Connector slot</div>}
      />,
    );

    const toggle = screen.getByRole('button', { name: /0x012345/i });
    fireEvent.click(toggle);

    expect(screen.getByText('Connection')).toBeTruthy();
    expect(screen.getByText('Channels')).toBeTruthy();
    expect(screen.getByText('Payments')).toBeTruthy();
    expect(screen.getByText('Connector')).toBeTruthy();
    expect(screen.getByText('Connector slot')).toBeTruthy();

    await waitFor(() => {
      expect(node.listPeers).toHaveBeenCalled();
    });
  });
});
