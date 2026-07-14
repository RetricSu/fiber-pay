import { ChannelState, serializeUdtTypeScript } from '@fiber-pay/sdk/browser';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    openChannel: vi.fn(async () => ({ temporary_channel_id: '0xtemporary' })),
    newInvoice: vi.fn(async () => ({ invoice_address: 'ln-fake-invoice' })),
    parseInvoice: vi.fn(async () => ({
      invoice: { currency: 'Fibt', data: { payment_hash: '0x1', attrs: [] } },
    })),
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

function createUdtChannel(script = validUdtScript) {
  return {
    channel_id: '0xchannel',
    is_public: false,
    is_acceptor: false,
    is_one_way: false,
    channel_outpoint: null,
    pubkey: '0xpeer',
    funding_udt_type_script: script,
    state: { state_name: ChannelState.ChannelReady },
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
}

function createCkbChannel() {
  return {
    ...createUdtChannel(),
    channel_id: '0xckb-channel',
    funding_udt_type_script: null,
    local_balance: '0x5f5e100',
    remote_balance: '0xbebc200',
  };
}

function selectAsset(label: string, optionName: string) {
  const select = screen.getByLabelText(label);
  const option = within(select).getByRole('option', { name: optionName });
  fireEvent.change(select, { target: { value: option.getAttribute('value') } });
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
      nodeInfo: {
        pubkey: '0x0123456789abcdef0123456789abcdef',
        udt_cfg_infos: [{ script: validUdtScript }],
      } as UseFiberNodeResult['nodeInfo'],
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

  it('loads and renders panel data in React StrictMode', async () => {
    const node = createNodeMock();
    node.listChannels = vi.fn(async () => ({
      channels: [
        {
          channel_id: '0xstrict',
          pubkey: '0xpeer',
          funding_udt_type_script: null,
          state: { state_name: ChannelState.ChannelReady },
          local_balance: '0x5f5e100',
          remote_balance: '0x5f5e100',
          pending_tlcs: [],
        },
      ],
    }));
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: {
        pubkey: '0x0123456789abcdef0123456789abcdef',
        udt_cfg_infos: [{ script: validUdtScript }],
      } as UseFiberNodeResult['nodeInfo'],
    });

    render(
      <StrictMode>
        <FiberNodeButton fiber={fiber} strategy="passkey" />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'active (1)' })).toBeTruthy();
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
      nodeInfo: {
        pubkey: '0x0123456789abcdef0123456789abcdef',
        udt_cfg_infos: [{ script: validUdtScript }],
      } as UseFiberNodeResult['nodeInfo'],
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

  it('opens a UDT channel and pays a matching UDT invoice from the high-level panel', async () => {
    const node = createNodeMock();
    node.parseInvoice = vi.fn(async () => ({
      invoice: {
        currency: 'Fibt',
        data: {
          payment_hash: '0x1',
          attrs: [{ udt_script: serializeUdtTypeScript(validUdtScript) }],
        },
      },
    }));
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: {
        pubkey: '0x0123456789abcdef0123456789abcdef',
        udt_cfg_infos: [{ script: validUdtScript }],
      } as UseFiberNodeResult['nodeInfo'],
    });

    render(
      <FiberNodeButton
        fiber={fiber}
        strategy="passkey"
        asset={{ kind: 'udt', script: validUdtScript, name: 'RUSD' }}
        initialPeerPubkey="0xpeer"
        initialFundingAmount="100"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Channel' }));

    await waitFor(() => {
      expect(node.openChannel).toHaveBeenCalledWith({
        pubkey: '0xpeer',
        funding_amount: '0x64',
        funding_udt_type_script: validUdtScript,
      });
    });

    fireEvent.change(screen.getByLabelText('Invoice'), { target: { value: '  ln-udt  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pay Invoice' }));

    await waitFor(() => {
      expect(node.sendPayment).toHaveBeenCalledWith({
        invoice: 'ln-udt',
        udt_type_script: validUdtScript,
      });
      expect(screen.getByText('Status: Succeeded')).toBeTruthy();
    });
  });

  it('selects configured assets independently for opening, invoicing, and paying', async () => {
    const node = createNodeMock();
    node.parseInvoice = vi.fn(async () => ({
      invoice: {
        currency: 'Fibt',
        data: {
          payment_hash: '0x1',
          attrs: [{ udt_script: serializeUdtTypeScript(validUdtScript) }],
        },
      },
    }));
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: {
        pubkey: '0x0123456789abcdef0123456789abcdef',
        udt_cfg_infos: [{ name: 'RUSD', script: validUdtScript, cell_deps: [] }],
      } as UseFiberNodeResult['nodeInfo'],
    });

    render(<FiberNodeButton fiber={fiber} strategy="passkey" initialPeerPubkey="0xpeer" />);
    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));

    selectAsset('Open Channel Asset', 'RUSD');
    const fundingAmount = screen.getByLabelText('Funding Amount (UDT raw units)');
    fireEvent.change(fundingAmount, { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open Channel' }));

    await waitFor(() => {
      expect(node.openChannel).toHaveBeenCalledWith({
        pubkey: '0xpeer',
        funding_amount: '0xfa',
        funding_udt_type_script: validUdtScript,
      });
    });

    selectAsset('Create Invoice Asset', 'RUSD');
    const invoiceAmount = screen.getByLabelText('Invoice Amount (UDT raw units)');
    expect((invoiceAmount as HTMLInputElement).value).toBe('');
    fireEvent.change(invoiceAmount, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Invoice (25 RUSD)' }));

    await waitFor(() => {
      expect(node.newInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: '0x19',
          udt_type_script: validUdtScript,
        }),
      );
    });

    selectAsset('Pay Invoice Asset', 'RUSD');
    fireEvent.change(screen.getByLabelText('Invoice'), { target: { value: 'ln-rusd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pay Invoice' }));

    await waitFor(() => {
      expect(node.sendPayment).toHaveBeenCalledWith({
        invoice: 'ln-rusd',
        udt_type_script: validUdtScript,
      });
    });
  });

  it('accepts a custom UDT script from the asset selector', async () => {
    const node = createNodeMock();
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: {
        pubkey: '0x0123456789abcdef0123456789abcdef',
        udt_cfg_infos: [{ name: 'RUSD', script: validUdtScript, cell_deps: [] }],
      } as UseFiberNodeResult['nodeInfo'],
    });

    render(<FiberNodeButton fiber={fiber} strategy="passkey" initialPeerPubkey="0xpeer" />);
    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));

    selectAsset('Open Channel Asset', 'Custom');
    fireEvent.change(screen.getByLabelText('Open Channel Asset Custom UDT Script (JSON)'), {
      target: { value: JSON.stringify(validUdtScript) },
    });
    fireEvent.change(screen.getByLabelText('Funding Amount (UDT raw units)'), {
      target: { value: '500' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open Channel' }));

    await waitFor(() => {
      expect(node.openChannel).toHaveBeenCalledWith({
        pubkey: '0xpeer',
        funding_amount: '0x1f4',
        funding_udt_type_script: validUdtScript,
      });
    });
  });

  it('recovers the Open Channel action after an invalid UDT script error', async () => {
    const node = createNodeMock();
    const onError = vi.fn();
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
        asset={{ kind: 'udt', script: { ...validUdtScript, code_hash: '0x00' } }}
        initialPeerPubkey="0xpeer"
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Channel' }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('code_hash must be 66'));
      expect(screen.getByRole('button', { name: 'Open Channel' }).hasAttribute('disabled')).toBe(
        false,
      );
    });
    expect(node.openChannel).not.toHaveBeenCalled();
  });

  it('reports an actionable error when the UDT is absent from the node whitelist', async () => {
    const node = createNodeMock();
    const onError = vi.fn();
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: {
        pubkey: '0x0123456789abcdef0123456789abcdef',
        udt_cfg_infos: [],
      } as unknown as UseFiberNodeResult['nodeInfo'],
    });

    render(
      <FiberNodeButton
        fiber={fiber}
        strategy="passkey"
        asset={{ kind: 'udt', script: validUdtScript, name: 'RUSD' }}
        initialPeerPubkey="0xpeer"
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Channel' }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining('not present in the node whitelist'),
      );
    });
    expect(node.openChannel).not.toHaveBeenCalled();
  });

  it('passes asset-aware amounts to external funding resolvers', async () => {
    const node = createNodeMock();
    const asset = { kind: 'udt' as const, script: validUdtScript, name: 'RUSD' };
    const resolve = vi.fn(async () => {
      throw new Error('stop after context capture');
    });
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: {
        pubkey: '0x0123456789abcdef0123456789abcdef',
        udt_cfg_infos: [{ script: validUdtScript }],
      } as UseFiberNodeResult['nodeInfo'],
    });

    render(
      <FiberNodeButton
        fiber={fiber}
        strategy="passkey"
        asset={asset}
        initialPeerPubkey="0xpeer"
        initialFundingAmount="500"
        externalFunding={{ enabled: true, resolve }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Channel' }));

    await waitFor(() => {
      expect(resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          node,
          pubkey: '0xpeer',
          asset,
          fundingAmount: '500',
          fundingAmountCkb: '500',
        }),
      );
    });
  });

  it('uses the shared fiber network when creating invoices', async () => {
    const node = createNodeMock();
    const fiber = createFiberMock({
      network: 'mainnet',
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    render(<FiberNodeButton fiber={fiber} strategy="passkey" invoiceAmount="2" />);
    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('button', { name: /Create Invoice/i }));

    await waitFor(() => {
      expect(node.newInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'Fibb', amount: '0xbebc200' }),
      );
    });
  });

  it('splits mixed channels by asset and exposes the UDT script in details', async () => {
    const udtChannel = { ...createUdtChannel(), channel_id: '0xudt-channel' };
    const closedUdtChannel = {
      ...createUdtChannel(),
      channel_id: '0xclosed-udt',
      state: { state_name: ChannelState.Closed },
      local_balance: '0x3e8',
    };
    const node = createNodeMock();
    node.listChannels = vi.fn(async () => ({
      channels: [createCkbChannel(), udtChannel, closedUdtChannel],
    }));
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: {
        pubkey: '0x0123456789abcdef0123456789abcdef',
        udt_cfg_infos: [{ name: 'RUSD', script: validUdtScript, cell_deps: [] }],
      } as UseFiberNodeResult['nodeInfo'],
    });

    render(<FiberNodeButton fiber={fiber} strategy="passkey" />);
    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));

    await waitFor(() => {
      expect(screen.getByText('Assets: CKB 1 · RUSD 2')).toBeTruthy();
    });

    const assetFilters = screen.getByRole('group', { name: 'Channel asset filter' });
    fireEvent.click(within(assetFilters).getByRole('button', { name: 'RUSD (2)' }));

    await waitFor(() => {
      expect(screen.getAllByText(/100 RUSD/).length).toBeGreaterThan(0);
      expect(screen.getByText('Funding UDT Script')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'active (1)' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'closed (1)' })).toBeTruthy();
    });
    expect(screen.queryByText(/1\.0000 CKB/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'closed (1)' }));
    await waitFor(() => {
      expect(screen.getAllByText(/0xclosed-udt/).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText('Funding UDT Script'));
    expect(screen.getByText(new RegExp(validUdtScript.code_hash.slice(0, 18)))).toBeTruthy();
  });

  it('uses configured UDT names in graph diagnostics', async () => {
    const node = createNodeMock();
    node.graphChannels = vi.fn(async () => ({
      channels: [
        {
          node1: '0xnode1',
          node2: '0xnode2',
          channel_outpoint: { tx_hash: '0xtx', index: '0x0' },
          capacity: '0x64',
          udt_type_script: validUdtScript,
        },
      ],
      last_cursor: '0x0',
    }));
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: {
        pubkey: '0x0123456789abcdef0123456789abcdef',
        udt_cfg_infos: [{ name: 'RUSD', script: validUdtScript, cell_deps: [] }],
      } as UseFiberNodeResult['nodeInfo'],
    });

    render(<FiberNodeButton fiber={fiber} strategy="passkey" />);
    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }));

    await waitFor(() => {
      expect(screen.getByText(/100 RUSD/)).toBeTruthy();
    });
  });

  it('keeps the CKB-only panel quiet and constrains the dropdown for narrow viewports', () => {
    const node = createNodeMock();
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: node as unknown as UseFiberNodeResult['node'],
      nodeInfo: {
        pubkey: '0x0123456789abcdef0123456789abcdef',
        udt_cfg_infos: [],
      } as unknown as UseFiberNodeResult['nodeInfo'],
    });

    render(<FiberNodeButton fiber={fiber} strategy="passkey" />);
    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));

    expect(screen.queryByLabelText('Open Channel Asset')).toBeNull();
    expect(screen.queryByLabelText('Create Invoice Asset')).toBeNull();
    expect(screen.queryByLabelText('Pay Invoice Asset')).toBeNull();

    const dialog = screen.getByRole('dialog', { name: 'Connection panel' });
    expect(dialog.style.maxWidth).toBe('520px');
    expect(dialog.style.width).toBe('calc(100vw - 1rem)');
    expect(dialog.style.boxSizing).toBe('border-box');

    const tabList = screen.getByRole('tablist', { name: 'Fiber panel tabs' });
    expect(tabList.style.overflow).toBe('hidden');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.style.minWidth).toBe('0');
      expect(tab.style.whiteSpace).toBe('nowrap');
    }
  });

  it('shows UDT unit for channels with funding_udt_type_script', async () => {
    const udtChannel = createUdtChannel();

    const node = createNodeMock();
    node.listChannels = vi.fn(async () => ({ channels: [udtChannel] }));

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
        asset={{ kind: 'udt', script: udtChannel.funding_udt_type_script, name: 'RUSD' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));

    await waitFor(() => {
      expect(screen.getAllByText(/\b100 RUSD\b/).length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getByText(/Local 100 RUSD/)).toBeTruthy();
      expect(screen.getByText(/Remote 50 RUSD/)).toBeTruthy();
    });
  });

  it('does not label a different UDT channel with the configured asset name', async () => {
    const udtChannel = createUdtChannel({ ...validUdtScript, args: '0x01' });
    const node = createNodeMock();
    node.listChannels = vi.fn(async () => ({ channels: [udtChannel] }));
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
        asset={{ kind: 'udt', script: validUdtScript, name: 'RUSD' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /0x012345/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));

    await waitFor(() => {
      expect(screen.getAllByText('UDT').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/100 RUSD/)).toBeNull();
  });
});
