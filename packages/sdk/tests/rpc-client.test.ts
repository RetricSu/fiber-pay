import type {
  BuildRouterParams,
  CkbInvoiceStatus,
  HexString,
  HopHint,
  HopRequire,
  NewInvoiceParams,
  RouterHop,
  SendPaymentParams,
  SendPaymentWithRouterParams,
  SettleInvoiceParams,
} from '@fiber-pay/sdk';
import { FiberRpcClient } from '@fiber-pay/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// Mock fetch helper
// =============================================================================

function mockFetch(result: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      jsonrpc: '2.0',
      id: 1,
      result,
    }),
  });
}

function mockFetchSequence(results: unknown[]) {
  let callIndex = 0;
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      jsonrpc: '2.0',
      id: ++callIndex,
      result: results[Math.min(callIndex - 1, results.length - 1)],
    }),
  }));
}

describe('FiberRpcClient - New Methods', () => {
  let client: FiberRpcClient;
  let originalFetch: typeof globalThis.fetch;

  const outPoint = {
    tx_hash: '0x1234' as HexString,
    index: '0x0' as HexString,
  };

  beforeEach(() => {
    client = new FiberRpcClient({ url: 'http://127.0.0.1:8227' });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('call', () => {
    it('should throw if JSON-RPC response has neither result nor error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
        }),
      });

      await expect(client.call('node_info', [])).rejects.toThrow(
        'Invalid JSON-RPC response: missing result and error',
      );
    });
  });

  // ===========================================================================
  // settleInvoice
  // ===========================================================================

  describe('settleInvoice', () => {
    it('should call settle_invoice RPC method with correct params', async () => {
      const fetchMock = mockFetch(null);
      globalThis.fetch = fetchMock;

      const params: SettleInvoiceParams = {
        payment_hash: '0xaabbccdd' as HexString,
        payment_preimage: '0x1122334455' as HexString,
      };

      const result = await client.settleInvoice(params);

      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledOnce();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.method).toBe('settle_invoice');
      expect(body.params).toEqual([params]);
    });
  });

  // ===========================================================================
  // buildRouter
  // ===========================================================================

  describe('buildRouter', () => {
    it('should call build_router RPC method with correct params', async () => {
      const mockHops: RouterHop[] = [
        {
          target: '0xaabb' as HexString,
          channel_outpoint: outPoint,
          amount_received: '0x5f5e100' as HexString,
          incoming_tlc_expiry: '0x3e8' as HexString,
        },
      ];
      const fetchMock = mockFetch({ router_hops: mockHops });
      globalThis.fetch = fetchMock;

      const params: BuildRouterParams = {
        amount: '0x5f5e100' as HexString,
        hops_info: [{ pubkey: '0xaabb' as HexString, channel_outpoint: outPoint }],
      };

      const result = await client.buildRouter(params);

      expect(result.router_hops).toEqual(mockHops);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.method).toBe('build_router');
      expect(body.params).toEqual([params]);
    });
  });

  // ===========================================================================
  // sendPaymentWithRouter
  // ===========================================================================

  describe('sendPaymentWithRouter', () => {
    it('should call send_payment_with_router RPC method', async () => {
      const mockResult = {
        payment_hash: '0xdeadbeef' as HexString,
        status: 'Success' as const,
        created_at: '0x0' as HexString,
        last_updated_at: '0x0' as HexString,
        fee: '0x3e8' as HexString,
      };
      const fetchMock = mockFetch(mockResult);
      globalThis.fetch = fetchMock;

      const params: SendPaymentWithRouterParams = {
        router: [
          {
            target: '0xaabb' as HexString,
            channel_outpoint: outPoint,
            amount_received: '0x5f5e100' as HexString,
            incoming_tlc_expiry: '0x3e8' as HexString,
          },
        ],
        keysend: true,
      };

      const result = await client.sendPaymentWithRouter(params);

      expect(result.payment_hash).toBe('0xdeadbeef');
      expect(result.status).toBe('Success');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.method).toBe('send_payment_with_router');
    });
  });

  // ===========================================================================
  // send_payment extended params
  // ===========================================================================

  describe('sendPayment - extended params', () => {
    it('should include custom_records in RPC call', async () => {
      const fetchMock = mockFetch({
        payment_hash: '0x123' as HexString,
        status: 'Created',
        created_at: '0x0' as HexString,
        last_updated_at: '0x0' as HexString,
        fee: '0x0' as HexString,
      });
      globalThis.fetch = fetchMock;

      const params: SendPaymentParams = {
        invoice: 'fibt1test',
        custom_records: { '65536': '0x48656c6c6f' as HexString },
      };

      await client.sendPayment(params);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.params[0].custom_records).toEqual({ '65536': '0x48656c6c6f' });
    });

    it('should include hop_hints in RPC call', async () => {
      const fetchMock = mockFetch({
        payment_hash: '0x123' as HexString,
        status: 'Created',
        created_at: '0x0' as HexString,
        last_updated_at: '0x0' as HexString,
        fee: '0x0' as HexString,
      });
      globalThis.fetch = fetchMock;

      const hints: HopHint[] = [
        {
          pubkey: '0xaabb' as HexString,
          channel_outpoint: outPoint,
          fee_rate: '0x3e8' as HexString,
          tlc_expiry_delta: '0x10' as HexString,
        },
      ];

      await client.sendPayment({
        invoice: 'fibt1test',
        hop_hints: hints,
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.params[0].hop_hints).toEqual(hints);
    });

    it('should accept max_parts as HexString', async () => {
      const fetchMock = mockFetch({
        payment_hash: '0x123' as HexString,
        status: 'Created',
        created_at: '0x0' as HexString,
        last_updated_at: '0x0' as HexString,
        fee: '0x0' as HexString,
      });
      globalThis.fetch = fetchMock;

      await client.sendPayment({
        invoice: 'fibt1test',
        max_parts: '0x4' as HexString,
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.params[0].max_parts).toBe('0x4');
    });
  });

  // ===========================================================================
  // new_invoice with payment_hash (hold invoice)
  // ===========================================================================

  describe('newInvoice - hold invoice', () => {
    it('should accept payment_hash for hold invoices', async () => {
      const fetchMock = mockFetch({
        invoice_address: 'fibt1testinvoice',
        invoice: {
          currency: 'Fibt',
          amount: '0x5f5e100' as HexString,
          data: {
            timestamp: '0x0' as HexString,
            payment_hash: '0xdeadbeef' as HexString,
            attrs: [],
          },
        },
      });
      globalThis.fetch = fetchMock;

      const params: NewInvoiceParams = {
        amount: '0x5f5e100' as HexString,
        currency: 'Fibt',
        payment_hash: '0xdeadbeef' as HexString,
      };

      await client.newInvoice(params);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.params[0].payment_hash).toBe('0xdeadbeef');
      // Should NOT have payment_preimage
      expect(body.params[0].payment_preimage).toBeUndefined();
    });
  });
});

// =============================================================================
// Polling / Watching Helpers
// =============================================================================

describe('FiberRpcClient - Polling Helpers', () => {
  let client: FiberRpcClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    client = new FiberRpcClient({ url: 'http://127.0.0.1:8227' });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('waitForPayment', () => {
    it('should resolve when payment reaches Success', async () => {
      const fetchMock = mockFetchSequence([
        // First poll: Inflight
        {
          payment_hash: '0xaabb',
          status: 'Inflight',
          created_at: '0x0',
          last_updated_at: '0x0',
          fee: '0x0',
        },
        // Second poll: Success
        {
          payment_hash: '0xaabb',
          status: 'Success',
          created_at: '0x0',
          last_updated_at: '0x0',
          fee: '0x3e8',
        },
      ]);
      globalThis.fetch = fetchMock;

      const result = await client.waitForPayment('0xaabb' as HexString, {
        timeout: 10000,
        interval: 10,
      });

      expect(result.status).toBe('Success');
      expect(result.fee).toBe('0x3e8');
    });

    it('should resolve when payment reaches Failed', async () => {
      const fetchMock = mockFetchSequence([
        {
          payment_hash: '0xaabb',
          status: 'Created',
          created_at: '0x0',
          last_updated_at: '0x0',
          fee: '0x0',
        },
        {
          payment_hash: '0xaabb',
          status: 'Failed',
          created_at: '0x0',
          last_updated_at: '0x0',
          fee: '0x0',
          failed_error: 'No route',
        },
      ]);
      globalThis.fetch = fetchMock;

      const result = await client.waitForPayment('0xaabb' as HexString, {
        timeout: 10000,
        interval: 10,
      });

      expect(result.status).toBe('Failed');
      expect(result.failed_error).toBe('No route');
    });

    it('should throw on timeout', async () => {
      const fetchMock = mockFetch({
        payment_hash: '0xaabb',
        status: 'Inflight',
        created_at: '0x0',
        last_updated_at: '0x0',
        fee: '0x0',
      });
      globalThis.fetch = fetchMock;

      await expect(
        client.waitForPayment('0xaabb' as HexString, { timeout: 50, interval: 10 }),
      ).rejects.toThrow('did not complete within');
    });
  });

  describe('waitForChannelReady', () => {
    it('should normalize legacy uppercase channel states from RPC', async () => {
      const fetchMock = mockFetch({
        channels: [
          {
            channel_id: '0xch-upper',
            peer_id: 'QmTest',
            is_public: true,
            channel_outpoint: null,
            funding_udt_type_script: null,
            state: { state_name: 'CHANNEL_READY', state_flags: [] },
            local_balance: '0x0',
            remote_balance: '0x0',
            offered_tlc_balance: '0x0',
            received_tlc_balance: '0x0',
            pending_tlcs: [],
            latest_commitment_transaction_hash: null,
            created_at: '0x0',
            enabled: true,
            tlc_expiry_delta: '0x0',
            tlc_fee_proportional_millionths: '0x0',
            shutdown_transaction_hash: null,
          },
        ],
      });
      globalThis.fetch = fetchMock;

      const result = await client.listChannels({});
      expect(result.channels[0].state.state_name).toBe('CHANNEL_READY');
    });

    it('should resolve when channel reaches ChannelReady', async () => {
      const fetchMock = mockFetchSequence([
        // First poll: AwaitingChannelReady
        {
          channels: [
            {
              channel_id: '0xch1',
              peer_id: 'QmTest',
              is_public: true,
              channel_outpoint: null,
              funding_udt_type_script: null,
              state: { state_name: 'AWAITING_CHANNEL_READY', state_flags: [] },
              local_balance: '0x0',
              remote_balance: '0x0',
              offered_tlc_balance: '0x0',
              received_tlc_balance: '0x0',
              pending_tlcs: [],
              latest_commitment_transaction_hash: null,
              created_at: '0x0',
              enabled: true,
              tlc_expiry_delta: '0x0',
              tlc_fee_proportional_millionths: '0x0',
              shutdown_transaction_hash: null,
            },
          ],
        },
        // Second poll: ChannelReady
        {
          channels: [
            {
              channel_id: '0xch1',
              peer_id: 'QmTest',
              is_public: true,
              channel_outpoint: null,
              funding_udt_type_script: null,
              state: { state_name: 'CHANNEL_READY', state_flags: [] },
              local_balance: '0x5f5e100',
              remote_balance: '0x0',
              offered_tlc_balance: '0x0',
              received_tlc_balance: '0x0',
              pending_tlcs: [],
              latest_commitment_transaction_hash: null,
              created_at: '0x0',
              enabled: true,
              tlc_expiry_delta: '0x0',
              tlc_fee_proportional_millionths: '0x0',
              shutdown_transaction_hash: null,
            },
          ],
        },
      ]);
      globalThis.fetch = fetchMock;

      const result = await client.waitForChannelReady('0xch1' as HexString, {
        timeout: 10000,
        interval: 10,
      });

      expect(result.state.state_name).toBe('CHANNEL_READY');
      expect(result.local_balance).toBe('0x5f5e100');
    });

    it('should throw if channel is Closed', async () => {
      const fetchMock = mockFetch({
        channels: [
          {
            channel_id: '0xch1',
            peer_id: 'QmTest',
            is_public: true,
            channel_outpoint: null,
            funding_udt_type_script: null,
            state: { state_name: 'Closed', state_flags: [] },
            local_balance: '0x0',
            remote_balance: '0x0',
            offered_tlc_balance: '0x0',
            received_tlc_balance: '0x0',
            pending_tlcs: [],
            latest_commitment_transaction_hash: null,
            created_at: '0x0',
            enabled: true,
            tlc_expiry_delta: '0x0',
            tlc_fee_proportional_millionths: '0x0',
            shutdown_transaction_hash: null,
          },
        ],
      });
      globalThis.fetch = fetchMock;

      await expect(
        client.waitForChannelReady('0xch1' as HexString, { timeout: 1000, interval: 10 }),
      ).rejects.toThrow('was closed before becoming ready');
    });
  });

  describe('waitForInvoiceStatus', () => {
    it('should resolve when invoice reaches Received', async () => {
      const fetchMock = mockFetchSequence([
        // First: Open
        {
          invoice_address: 'fibt1',
          invoice: {
            currency: 'Fibt',
            data: { timestamp: '0x0', payment_hash: '0xh1', attrs: [] },
          },
          status: 'Open',
        },
        // Second: Received
        {
          invoice_address: 'fibt1',
          invoice: {
            currency: 'Fibt',
            data: { timestamp: '0x0', payment_hash: '0xh1', attrs: [] },
          },
          status: 'Received',
        },
      ]);
      globalThis.fetch = fetchMock;

      const result = await client.waitForInvoiceStatus('0xh1' as HexString, 'Received', {
        timeout: 10000,
        interval: 10,
      });

      expect(result.status).toBe('Received');
    });

    it('should accept array of target statuses', async () => {
      const fetchMock = mockFetch({
        invoice_address: 'fibt1',
        invoice: { currency: 'Fibt', data: { timestamp: '0x0', payment_hash: '0xh1', attrs: [] } },
        status: 'Paid',
      });
      globalThis.fetch = fetchMock;

      const result = await client.waitForInvoiceStatus('0xh1' as HexString, ['Received', 'Paid'], {
        timeout: 10000,
        interval: 10,
      });

      expect(result.status).toBe('Paid');
    });

    it('should throw if invoice is Cancelled', async () => {
      const fetchMock = mockFetch({
        invoice_address: 'fibt1',
        invoice: { currency: 'Fibt', data: { timestamp: '0x0', payment_hash: '0xh1', attrs: [] } },
        status: 'Cancelled',
      });
      globalThis.fetch = fetchMock;

      await expect(
        client.waitForInvoiceStatus('0xh1' as HexString, 'Received', {
          timeout: 1000,
          interval: 10,
        }),
      ).rejects.toThrow('was cancelled');
    });
  });
});

// =============================================================================
// Type Correctness Tests (compile-time assertions)
// =============================================================================

describe('Type Correctness', () => {
  it('CkbInvoiceStatus should include v0.6.1 variants', () => {
    const statuses: CkbInvoiceStatus[] = ['Open', 'Cancelled', 'Expired', 'Received', 'Paid'];
    expect(statuses).toHaveLength(5);
  });

  it('HopRequire should have correct shape', () => {
    const hop: HopRequire = {
      pubkey: '0xaabb' as HexString,
      channel_outpoint: { tx_hash: '0x1234' as HexString, index: '0x0' as HexString },
    };
    expect(hop.pubkey).toBe('0xaabb');
  });

  it('RouterHop should have correct shape', () => {
    const hop: RouterHop = {
      target: '0xaabb' as HexString,
      channel_outpoint: { tx_hash: '0x1234' as HexString, index: '0x0' as HexString },
      amount_received: '0x5f5e100' as HexString,
      incoming_tlc_expiry: '0x3e8' as HexString,
    };
    expect(hop.target).toBe('0xaabb');
    expect(hop.incoming_tlc_expiry).toBe('0x3e8');
  });
});
