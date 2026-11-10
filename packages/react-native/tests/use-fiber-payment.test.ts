import { FiberRpcClient } from '@fiber-pay/sdk';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFiberPayment } from '../src/use-fiber-payment.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PAYMENT_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PAYMENT_HASH_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function ckbInvoice(currency: 'Fibt' | 'Fibb', paymentHash: string) {
  return { currency, data: { payment_hash: paymentHash, attrs: [] } };
}

function udtInvoice(currency: 'Fibt' | 'Fibb', paymentHash: string) {
  return {
    currency,
    data: {
      payment_hash: paymentHash,
      attrs: [{ udt_script: '0xdeadbeef' }],
    },
  };
}

/** Let pending promise continuations (e.g. the next fetch in a chain) run. */
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

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

/** Fetch mock where each (url, method) pair only resolves when `respond`/`fail` is called for it. */
function stubFetchController() {
  const pending = new Map<string, Array<(envelope: Record<string, unknown>) => void>>();

  const fetchMock = vi.fn((url: string | URL, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { id: number; method: string };
    const key = `${url}:${body.method}`;
    return new Promise((resolve) => {
      const waiters = pending.get(key) ?? [];
      waiters.push((envelope) => {
        resolve({
          ok: true,
          status: 200,
          json: async () => ({ jsonrpc: '2.0', id: body.id, ...envelope }),
        });
      });
      pending.set(key, waiters);
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  const take = (url: string, method: string) => {
    const key = `${url}:${method}`;
    const waiter = pending.get(key)?.shift();
    if (!waiter) throw new Error(`no pending request for ${key}`);
    return waiter;
  };

  return {
    respond(url: string, method: string, result: unknown) {
      take(url, method)({ result });
    },
    fail(url: string, method: string, message: string) {
      take(url, method)({ error: { code: -1, message } });
    },
  };
}

describe('useFiberPayment', () => {
  it('sets `error` for every action when there is no client yet, not just payInvoice', async () => {
    const { result } = renderHook(() => useFiberPayment(null));

    await expect(result.current.createInvoice({ amount: '0x1', currency: 'Fibt' })).rejects.toThrow(
      'Fiber client is not initialized',
    );
    await waitFor(() => expect(result.current.error).toBe('Fiber client is not initialized'));

    await expect(result.current.parseInvoice('fibt1...')).rejects.toThrow(
      'Fiber client is not initialized',
    );
    await expect(result.current.payInvoice('fibt1...')).rejects.toThrow(
      'Fiber client is not initialized',
    );
  });

  it('creates an invoice via new_invoice', async () => {
    stubFetchByMethod({
      new_invoice: { invoice_address: 'fibt1...', invoice: ckbInvoice('Fibt', PAYMENT_HASH) },
    });
    const client = new FiberRpcClient({ url: 'http://127.0.0.1:8227' });
    const { result } = renderHook(() => useFiberPayment(client));

    const invoice = await result.current.createInvoice({ amount: '0x1', currency: 'Fibt' });

    expect(invoice.invoice_address).toBe('fibt1...');
  });

  it('pays an invoice end to end and reports the settled result', async () => {
    stubFetchByMethod({
      parse_invoice: { invoice: ckbInvoice('Fibt', PAYMENT_HASH) },
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
    await waitFor(() => expect(result.current.isPaying).toBe(false));
    expect(result.current.paymentResult?.status).toBe('Success');
    expect(result.current.error).toBeNull();
  });

  it('surfaces a routing failure as an error instead of resolving silently', async () => {
    stubFetchByMethod({
      parse_invoice: { invoice: ckbInvoice('Fibt', PAYMENT_HASH) },
      send_payment: { payment_hash: PAYMENT_HASH, status: 'Inflight' },
      get_payment: { payment_hash: PAYMENT_HASH, status: 'Failed', failed_error: 'no route found' },
    });
    const client = new FiberRpcClient({ url: 'http://127.0.0.1:8227' });
    const { result } = renderHook(() => useFiberPayment(client));

    await act(async () => {
      await expect(result.current.payInvoice('fibt1...')).rejects.toThrow('no route found');
    });
    expect(result.current.error).toBe('no route found');
  });

  it('rejects a UDT invoice (CKB-only for now) before sending anything', async () => {
    const fetchMock = stubFetchByMethod({
      parse_invoice: { invoice: udtInvoice('Fibt', PAYMENT_HASH) },
    });
    const client = new FiberRpcClient({ url: 'http://127.0.0.1:8227' });
    const { result } = renderHook(() => useFiberPayment(client));

    await act(async () => {
      await expect(result.current.payInvoice('fibt1...')).rejects.toThrow(
        'useFiberPayment only supports CKB',
      );
    });

    // Only parse_invoice should have gone out; no send_payment was attempted.
    const methodsCalled = fetchMock.mock.calls.map(
      ([, init]) => (JSON.parse((init as RequestInit).body as string) as { method: string }).method,
    );
    expect(methodsCalled).toEqual(['parse_invoice']);
  });

  it('rejects an invoice on the wrong network when `network` is set', async () => {
    stubFetchByMethod({
      parse_invoice: { invoice: ckbInvoice('Fibb', PAYMENT_HASH) },
    });
    const client = new FiberRpcClient({ url: 'http://127.0.0.1:8227' });
    const { result } = renderHook(() => useFiberPayment(client, { network: 'testnet' }));

    await act(async () => {
      await expect(result.current.payInvoice('fibb1...')).rejects.toThrow('network mismatch');
    });
  });

  it('rejects a second payInvoice call while one is already in flight', async () => {
    const ctrl = stubFetchController();
    const client = new FiberRpcClient({ url: 'http://node' });
    const { result } = renderHook(() => useFiberPayment(client));

    let firstCall: Promise<unknown>;
    act(() => {
      firstCall = result.current.payInvoice('fibt1...');
    });
    await waitFor(() => expect(result.current.isPaying).toBe(true));

    await expect(result.current.payInvoice('fibt1...')).rejects.toThrow(
      'A payment is already in progress',
    );

    // Let the first call finish so it doesn't leak into other tests.
    await act(async () => {
      ctrl.respond('http://node', 'parse_invoice', { invoice: ckbInvoice('Fibt', PAYMENT_HASH) });
      await flushMicrotasks();
      ctrl.respond('http://node', 'send_payment', { payment_hash: PAYMENT_HASH, status: 'Inflight' });
      await flushMicrotasks();
      ctrl.respond('http://node', 'get_payment', {
        payment_hash: PAYMENT_HASH,
        status: 'Success',
        fee: '0x0',
      });
      await firstCall!;
    });
  });

  it('does not let a stale client overwrite state after the client has changed', async () => {
    const ctrl = stubFetchController();
    const clientA = new FiberRpcClient({ url: 'http://node-a' });
    const clientB = new FiberRpcClient({ url: 'http://node-b' });

    const { result, rerender } = renderHook(
      ({ client }: { client: FiberRpcClient | null }) => useFiberPayment(client),
      { initialProps: { client: clientA as FiberRpcClient | null } },
    );

    // Start a createInvoice call against A, but leave it unresolved.
    let pendingA: Promise<unknown>;
    act(() => {
      pendingA = result.current.createInvoice({ amount: '0x1', currency: 'Fibt' });
    });

    // Swap to a different client before A resolves.
    rerender({ client: clientB });

    // B's own call succeeds normally.
    await act(async () => {
      const p = result.current.createInvoice({ amount: '0x2', currency: 'Fibt' });
      ctrl.respond('http://node-b', 'new_invoice', {
        invoice_address: 'fibt1-b',
        invoice: ckbInvoice('Fibt', PAYMENT_HASH_B),
      });
      await p;
    });

    expect(result.current.error).toBeNull();

    // Now let A's call come back late, as a failure. It must not land in
    // this hook's current (B) state.
    await act(async () => {
      ctrl.fail('http://node-a', 'new_invoice', 'node A went away');
      await expect(pendingA!).rejects.toThrow('node A went away');
    });

    expect(result.current.error).toBeNull();
  });

  it('resets isPaying, paymentResult, and error when client changes during an in-flight payment', async () => {
    const ctrl = stubFetchController();
    const clientA = new FiberRpcClient({ url: 'http://node-a' });
    const clientB = new FiberRpcClient({ url: 'http://node-b' });

    const { result, rerender } = renderHook(
      ({ client }: { client: FiberRpcClient | null }) => useFiberPayment(client),
      { initialProps: { client: clientA as FiberRpcClient | null } },
    );

    let payA: Promise<unknown>;
    act(() => {
      payA = result.current.payInvoice('fibt1...');
    });
    await waitFor(() => expect(result.current.isPaying).toBe(true));

    // Switch to client B while payment A is in flight
    rerender({ client: clientB });

    expect(result.current.isPaying).toBe(false);
    expect(result.current.paymentResult).toBeNull();
    expect(result.current.error).toBeNull();

    // Now let client A's payment complete
    await act(async () => {
      ctrl.respond('http://node-a', 'parse_invoice', { invoice: ckbInvoice('Fibt', PAYMENT_HASH) });
      await flushMicrotasks();
      ctrl.respond('http://node-a', 'send_payment', { payment_hash: PAYMENT_HASH, status: 'Inflight' });
      await flushMicrotasks();
      ctrl.respond('http://node-a', 'get_payment', {
        payment_hash: PAYMENT_HASH,
        status: 'Success',
        fee: '0x0',
      });
      await payA;
    });

    // Client A's completion must not set isPaying or paymentResult on client B
    expect(result.current.isPaying).toBe(false);
    expect(result.current.paymentResult).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('allows client B to initiate payment while client A payment is still in flight, without A releasing B lock', async () => {
    const ctrl = stubFetchController();
    const clientA = new FiberRpcClient({ url: 'http://node-a' });
    const clientB = new FiberRpcClient({ url: 'http://node-b' });

    const { result, rerender } = renderHook(
      ({ client }: { client: FiberRpcClient | null }) => useFiberPayment(client),
      { initialProps: { client: clientA as FiberRpcClient | null } },
    );

    let payA: Promise<unknown>;
    act(() => {
      payA = result.current.payInvoice('fibt1-a...');
    });
    await waitFor(() => expect(result.current.isPaying).toBe(true));

    // Switch to client B
    rerender({ client: clientB });
    expect(result.current.isPaying).toBe(false);

    // Client B can initiate payment without being blocked by client A
    let payB: Promise<unknown>;
    act(() => {
      payB = result.current.payInvoice('fibt1-b...');
    });
    await waitFor(() => expect(result.current.isPaying).toBe(true));

    // Now complete client A's payment
    await act(async () => {
      ctrl.respond('http://node-a', 'parse_invoice', { invoice: ckbInvoice('Fibt', PAYMENT_HASH) });
      await flushMicrotasks();
      ctrl.respond('http://node-a', 'send_payment', { payment_hash: PAYMENT_HASH, status: 'Inflight' });
      await flushMicrotasks();
      ctrl.respond('http://node-a', 'get_payment', {
        payment_hash: PAYMENT_HASH,
        status: 'Success',
        fee: '0x0',
      });
      await payA;
    });

    // Client A's completion must NOT clear Client B's isPaying or in-flight lock!
    expect(result.current.isPaying).toBe(true);

    // B should still reject a duplicate payment while B is in flight
    await expect(result.current.payInvoice('fibt1-b2...')).rejects.toThrow(
      'A payment is already in progress',
    );

    // Now let Client B's payment finish
    await act(async () => {
      ctrl.respond('http://node-b', 'parse_invoice', { invoice: ckbInvoice('Fibt', PAYMENT_HASH_B) });
      await flushMicrotasks();
      ctrl.respond('http://node-b', 'send_payment', { payment_hash: PAYMENT_HASH_B, status: 'Inflight' });
      await flushMicrotasks();
      ctrl.respond('http://node-b', 'get_payment', {
        payment_hash: PAYMENT_HASH_B,
        status: 'Success',
        fee: '0x0',
      });
      await payB;
    });

    expect(result.current.isPaying).toBe(false);
    expect(result.current.paymentResult?.status).toBe('Success');
  });

  it('clears previous settled paymentResult and error when client changes', async () => {
    stubFetchByMethod({
      parse_invoice: { invoice: ckbInvoice('Fibt', PAYMENT_HASH) },
      send_payment: { payment_hash: PAYMENT_HASH, status: 'Inflight' },
      get_payment: { payment_hash: PAYMENT_HASH, status: 'Success', fee: '0x0' },
    });
    const clientA = new FiberRpcClient({ url: 'http://node-a' });
    const clientB = new FiberRpcClient({ url: 'http://node-b' });

    const { result, rerender } = renderHook(
      ({ client }: { client: FiberRpcClient | null }) => useFiberPayment(client),
      { initialProps: { client: clientA as FiberRpcClient | null } },
    );

    await act(async () => {
      await result.current.payInvoice('fibt1...');
    });
    expect(result.current.paymentResult?.status).toBe('Success');

    // Switch to client B -> previous paymentResult should be cleared
    rerender({ client: clientB });
    expect(result.current.paymentResult).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
