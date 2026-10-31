import { FiberRpcClient } from '@fiber-pay/sdk';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFiberPayment } from '../src/use-fiber-payment.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PAYMENT_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function stubFetchByMethod(results: Record<string, unknown>) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { id: number; method: string };
    const result = results[body.method];
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: body.id, result }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('useFiberPayment', () => {
  it('throws from every action when there is no client yet', async () => {
    const { result } = renderHook(() => useFiberPayment(null));

    await expect(result.current.parseInvoice('fibt1...')).rejects.toThrow(
      'Fiber client is not initialized',
    );
  });

  it('creates an invoice via new_invoice', async () => {
    stubFetchByMethod({
      new_invoice: {
        invoice_address: 'fibt1...',
        invoice: { currency: 'Fibt', data: { payment_hash: PAYMENT_HASH } },
      },
    });
    const client = new FiberRpcClient({ url: 'http://127.0.0.1:8227' });
    const { result } = renderHook(() => useFiberPayment(client));

    const invoice = await result.current.createInvoice({
      amount: '0x1',
      currency: 'Fibt',
    });

    expect(invoice.invoice_address).toBe('fibt1...');
  });

  it('pays an invoice end to end and reports the settled result', async () => {
    stubFetchByMethod({
      parse_invoice: { invoice: { currency: 'Fibt', data: { payment_hash: PAYMENT_HASH } } },
      send_payment: { payment_hash: PAYMENT_HASH, status: 'Inflight' },
      get_payment: { payment_hash: PAYMENT_HASH, status: 'Success', fee: '0x0' },
    });
    const client = new FiberRpcClient({ url: 'http://127.0.0.1:8227' });
    const { result } = renderHook(() => useFiberPayment(client));

    let settled: Awaited<ReturnType<typeof result.current.payInvoice>> | undefined;
    await act(async () => {
      settled = await result.current.payInvoice('fibt1...');
    });

    expect(settled?.status).toBe('Success');
    await waitFor(() => {
      expect(result.current.isPaying).toBe(false);
    });
    expect(result.current.paymentResult?.status).toBe('Success');
    expect(result.current.error).toBeNull();
  });

  it('surfaces a routing failure as an error instead of resolving silently', async () => {
    stubFetchByMethod({
      parse_invoice: { invoice: { currency: 'Fibt', data: { payment_hash: PAYMENT_HASH } } },
      send_payment: { payment_hash: PAYMENT_HASH, status: 'Inflight' },
      get_payment: {
        payment_hash: PAYMENT_HASH,
        status: 'Failed',
        failed_error: 'no route found',
      },
    });
    const client = new FiberRpcClient({ url: 'http://127.0.0.1:8227' });
    const { result } = renderHook(() => useFiberPayment(client));

    await act(async () => {
      await expect(result.current.payInvoice('fibt1...')).rejects.toThrow('no route found');
    });
    expect(result.current.error).toBe('no route found');
  });
});
