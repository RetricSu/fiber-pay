import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelState } from '@fiber-pay/sdk/browser';
import { FiberNodeButton } from '../src/fiber-node-button.js';
import type { UseFiberNodeResult } from '../src/use-fiber-node.js';
import { validUdtScript } from './fixtures/udt.js';

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

describe('FiberNodeButton', () => {
  it('renders as a connect button when disconnected', () => {
    const fiber = createFiberMock();

    render(<FiberNodeButton fiber={fiber} strategy="password" password="secret" />);

    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('shows tabbed panel sections in dropdown when connected', async () => {
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

    expect(screen.getByRole('tab', { name: 'Workbench' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Channels' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Diagnostics' })).toBeTruthy();
    expect(screen.getByText('Connection Prep')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Open Channel' })).toBeTruthy();
    expect(screen.getByText('Payments')).toBeTruthy();
    expect(screen.getByText('Connector slot')).toBeTruthy();

    await waitFor(() => {
      expect(node.listPeers).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(node.listChannels).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(node.graphNodes).toHaveBeenCalled();
    });
  });

  it('lists channels and requests close for ready channel', async () => {
    const readyChannel = {
      channel_id: '0xchannel',
      is_public: false,
      is_acceptor: false,
      is_one_way: false,
      channel_outpoint: null,
      pubkey: '0xpeer',
      funding_udt_type_script: null,
      state: {
        state_name: ChannelState.ChannelReady,
      },
      local_balance: '0x5f5e100',
      offered_tlc_balance: '0x0',
      remote_balance: '0x3b9aca00',
      received_tlc_balance: '0x0',
      pending_tlcs: [],
      latest_commitment_transaction_hash: null,
      created_at: '0x1',
      enabled: true,
      tlc_expiry_delta: '0x0',
      tlc_fee_proportional_millionths: '0x0',
      shutdown_transaction_hash: null,
    };

    const node = createNodeMock();
    node.listChannels = vi.fn(async () => ({ channels: [readyChannel] }));

    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    render(<FiberNodeButton fiber={fiber} strategy="passkey" />);

    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));

    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'active (1)' })).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close Channel' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close Channel' }));

    await waitFor(() => {
      expect(node.shutdownChannel).toHaveBeenCalledWith({
        channel_id: '0xchannel',
        force: false,
      });
    });
  });

  it('creates UDT invoice with udt_type_script when asset is UDT', async () => {
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
        asset={{ kind: 'udt', script: validUdtScript, name: 'MyToken' }}
        invoiceAmount="100"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Invoice/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Invoice/i }));

    await waitFor(() => {
      expect(node.newInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: '0x64',
          udt_type_script: validUdtScript,
        }),
      );
    });
  });

  it('shows UDT unit for channels with funding_udt_type_script', async () => {
    const udtChannel = {
      channel_id: '0xchannel',
      is_public: false,
      is_acceptor: false,
      is_one_way: false,
      channel_outpoint: null,
      pubkey: '0xpeer',
      funding_udt_type_script: {
        code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
        hash_type: 'type',
        args: '0x00',
      },
      state: {
        state_name: ChannelState.ChannelReady,
      },
      local_balance: '0x64',
      offered_tlc_balance: '0x0',
      remote_balance: '0x32',
      received_tlc_balance: '0x0',
      pending_tlcs: [],
      latest_commitment_transaction_hash: null,
      created_at: '0x1',
      enabled: true,
      tlc_expiry_delta: '0x0',
      tlc_fee_proportional_millionths: '0x0',
      shutdown_transaction_hash: null,
    };

    const node = createNodeMock();
    node.listChannels = vi.fn(async () => ({ channels: [udtChannel] }));

    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    render(<FiberNodeButton fiber={fiber} strategy="passkey" asset={{ kind: 'udt', script: udtChannel.funding_udt_type_script }} />);

    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));

    await waitFor(() => {
      expect(screen.getAllByText(/\b100 UDT\b/).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText(/\b100 UDT\b/)[0]);

    await waitFor(() => {
      expect(screen.getAllByText(/\b50 UDT\b/).length).toBeGreaterThan(0);
    });
  });
});
