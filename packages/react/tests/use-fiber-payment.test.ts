import { act, cleanup, renderHook } from '@testing-library/react';
import {
  serializeUdtTypeScript,
  type FiberBrowserNode,
  type UdtAsset,
} from '@fiber-pay/sdk/browser';
import { createElement, StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFiberPayment } from '../src/use-fiber-payment.js';

afterEach(() => {
  cleanup();
});

function createNodeMock(overrides: Partial<FiberBrowserNode> = {}): FiberBrowserNode {
  return {
    parseInvoice: vi.fn(async () => ({ invoice: { data: { payment_hash: '0xabc' } } })),
    sendPayment: vi.fn(async () => ({ payment_hash: '0xabc' })),
    waitForPayment: vi.fn(async () => ({ status: 'Succeeded' })),
    ...overrides,
  } as unknown as FiberBrowserNode;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const validUdtScript = {
  code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
  hash_type: 'type' as const,
  args: '0x00',
};

function strictModeWrapper({ children }: { children: ReactNode }) {
  return createElement(StrictMode, null, children);
}

describe('useFiberPayment', () => {
  it('supports staged parse/send/wait APIs', async () => {
    const node = createNodeMock();
    const { result } = renderHook(() => useFiberPayment(node));

    let parsed: Awaited<ReturnType<FiberBrowserNode['parseInvoice']>> | undefined;
    await act(async () => {
      parsed = await result.current.parseInvoice('ln-invoice');
    });

    expect(node.parseInvoice).toHaveBeenCalledWith({ invoice: 'ln-invoice' });
    expect(parsed?.invoice.data.payment_hash).toBe('0xabc');

    await act(async () => {
      await result.current.sendPayment('ln-invoice');
    });

    expect(node.sendPayment).toHaveBeenCalledWith({ invoice: 'ln-invoice' });
    expect(result.current.isPaying).toBe(false);

    let payment: Awaited<ReturnType<FiberBrowserNode['waitForPayment']>> | undefined;
    await act(async () => {
      payment = await result.current.waitForPayment('0xabc');
    });

    expect(node.waitForPayment).toHaveBeenCalledWith('0xabc');
    expect(payment?.status).toBe('Succeeded');
    expect(result.current.paymentResult?.status).toBe('Succeeded');
    expect(result.current.error).toBeNull();
  });

  it('sets error when staged methods are called without an initialized node', async () => {
    const { result } = renderHook(() => useFiberPayment(null));

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.sendPayment('ln-invoice');
      } catch (error) {
        thrown = error;
      }
    });

    expect((thrown as Error).message).toBe('Node is not initialized');
    expect(result.current.error).toBe('Node is not initialized');
    expect(result.current.isPaying).toBe(false);
  });

  it('keeps payInvoice convenience flow working', async () => {
    const node = createNodeMock();
    const { result } = renderHook(() => useFiberPayment(node));

    await act(async () => {
      await result.current.payInvoice('ln-convenience');
    });

    expect(node.parseInvoice).toHaveBeenCalledWith({ invoice: 'ln-convenience' });
    expect(node.sendPayment).toHaveBeenCalledWith({ invoice: 'ln-convenience' });
    expect(node.waitForPayment).toHaveBeenCalledWith('0xabc');
    expect(result.current.paymentResult?.status).toBe('Succeeded');
    expect(result.current.error).toBeNull();
  });

  it('keeps payment state updates working in React StrictMode', async () => {
    const node = createNodeMock();
    const { result } = renderHook(() => useFiberPayment(node), { wrapper: strictModeWrapper });

    await act(async () => {
      await result.current.payInvoice('ln-strict');
    });

    expect(result.current.paymentResult?.status).toBe('Succeeded');
    expect(result.current.error).toBeNull();
    expect(result.current.isPaying).toBe(false);
  });

  it('clears stale paymentResult when staged sendPayment starts', async () => {
    const node = createNodeMock();
    const { result } = renderHook(() => useFiberPayment(node));

    await act(async () => {
      await result.current.waitForPayment('0xabc');
    });
    expect(result.current.paymentResult?.status).toBe('Succeeded');

    await act(async () => {
      await result.current.sendPayment('ln-next');
    });

    expect(result.current.paymentResult).toBeNull();
  });

  it('clears stale payment state when the asset context changes', async () => {
    const node = createNodeMock();
    const { result, rerender } = renderHook(({ asset }) => useFiberPayment(node, { asset }), {
      initialProps: { asset: { kind: 'ckb' } as UdtAsset },
    });

    await act(async () => {
      await result.current.waitForPayment('0xabc');
    });
    expect(result.current.paymentResult?.status).toBe('Succeeded');

    rerender({ asset: { kind: 'udt', script: validUdtScript } as UdtAsset });

    expect(result.current.paymentResult).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('ignores an in-flight result after the asset context changes', async () => {
    const deferred = createDeferred<{ status: 'Succeeded' }>();
    const node = createNodeMock({
      waitForPayment: vi.fn(() => deferred.promise),
    });
    const { result, rerender } = renderHook(({ asset }) => useFiberPayment(node, { asset }), {
      initialProps: { asset: { kind: 'ckb' } as UdtAsset },
    });

    let pendingWait: Promise<unknown> | undefined;
    await act(async () => {
      pendingWait = result.current.waitForPayment('0xold-asset');
      await Promise.resolve();
    });
    expect(result.current.isPaying).toBe(true);

    rerender({ asset: { kind: 'udt', script: validUdtScript } as UdtAsset });
    expect(result.current.isPaying).toBe(false);

    await act(async () => {
      deferred.resolve({ status: 'Succeeded' });
      await pendingWait;
    });

    expect(result.current.paymentResult).toBeNull();
    expect(result.current.isPaying).toBe(false);
  });

  it('clears stale paymentResult while staged waitForPayment is pending', async () => {
    const deferred = createDeferred<{ status: 'Succeeded' }>();
    const waitForPaymentMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 'Succeeded' })
      .mockImplementationOnce(() => deferred.promise);

    const node = createNodeMock({
      waitForPayment: waitForPaymentMock,
    });
    const { result } = renderHook(() => useFiberPayment(node));

    await act(async () => {
      await result.current.waitForPayment('0xfirst');
    });
    expect(result.current.paymentResult?.status).toBe('Succeeded');

    let pendingWait: Promise<unknown> | undefined;
    await act(async () => {
      pendingWait = result.current.waitForPayment('0xsecond');
      await Promise.resolve();
    });

    expect(result.current.paymentResult).toBeNull();
    expect(result.current.isPaying).toBe(true);

    await act(async () => {
      deferred.resolve({ status: 'Succeeded' });
      await pendingWait;
    });

    expect(result.current.paymentResult?.status).toBe('Succeeded');
    expect(result.current.isPaying).toBe(false);
  });

  it('captures failed payment message from payInvoice', async () => {
    const node = createNodeMock({
      waitForPayment: vi.fn(async () => ({ status: 'Failed', failed_error: 'route not found' })),
    });
    const { result } = renderHook(() => useFiberPayment(node));

    await act(async () => {
      await result.current.payInvoice('ln-failed');
    });

    expect(result.current.paymentResult).toBeNull();
    expect(result.current.error).toBe('route not found');
    expect(result.current.isPaying).toBe(false);
  });

  it('sends UDT payment with default asset', async () => {
    const node = createNodeMock();
    const asset = { kind: 'udt' as const, script: validUdtScript };
    const { result } = renderHook(() => useFiberPayment(node, { asset }));

    await act(async () => {
      await result.current.sendPayment('ln-udt');
    });

    expect(node.sendPayment).toHaveBeenCalledWith({
      invoice: 'ln-udt',
      udt_type_script: validUdtScript,
    });
  });

  it('pays a matching UDT invoice and trims pasted whitespace', async () => {
    const node = createNodeMock({
      parseInvoice: vi.fn(async () => ({
        invoice: {
          currency: 'Fibt',
          data: {
            payment_hash: '0xabc',
            attrs: [{ udt_script: serializeUdtTypeScript(validUdtScript) }],
          },
        },
      })),
    });
    const asset = { kind: 'udt' as const, script: validUdtScript };
    const { result } = renderHook(() => useFiberPayment(node, { asset, network: 'testnet' }));

    await act(async () => {
      await result.current.payInvoice('  ln-udt  ');
    });

    expect(node.parseInvoice).toHaveBeenCalledWith({ invoice: 'ln-udt' });
    expect(node.sendPayment).toHaveBeenCalledWith({
      invoice: 'ln-udt',
      udt_type_script: validUdtScript,
    });
    expect(result.current.paymentResult?.status).toBe('Succeeded');
  });

  it('rejects UDT invoices whose script does not match the configured asset', async () => {
    const node = createNodeMock({
      parseInvoice: vi.fn(async () => ({
        invoice: {
          currency: 'Fibt',
          data: {
            payment_hash: '0xabc',
            attrs: [
              {
                udt_script: serializeUdtTypeScript({ ...validUdtScript, args: '0x01' }),
              },
            ],
          },
        },
      })),
    });
    const asset = { kind: 'udt' as const, script: validUdtScript };
    const { result } = renderHook(() => useFiberPayment(node, { asset, network: 'testnet' }));

    await act(async () => {
      await result.current.payInvoice('ln-wrong-udt');
    });

    expect(node.sendPayment).not.toHaveBeenCalled();
    expect(result.current.error).toContain('UDT type script does not match');
  });

  it('rejects invoices from the wrong network before sending', async () => {
    const node = createNodeMock({
      parseInvoice: vi.fn(async () => ({
        invoice: {
          currency: 'Fibt',
          data: { payment_hash: '0xabc', attrs: [] },
        },
      })),
    });
    const { result } = renderHook(() =>
      useFiberPayment(node, { asset: { kind: 'ckb' }, network: 'mainnet' }),
    );

    await act(async () => {
      await result.current.payInvoice('ln-testnet');
    });

    expect(node.sendPayment).not.toHaveBeenCalled();
    expect(result.current.error).toContain('expected Fibb, received Fibt');
  });

  it('sends UDT payment with per-call asset', async () => {
    const node = createNodeMock();
    const { result } = renderHook(() => useFiberPayment(node));

    const asset = { kind: 'udt' as const, script: validUdtScript };
    await act(async () => {
      await result.current.sendPayment('ln-udt', { asset });
    });

    expect(node.sendPayment).toHaveBeenCalledWith({
      invoice: 'ln-udt',
      udt_type_script: validUdtScript,
    });
  });

  it('throws when UDT asset script is invalid', async () => {
    const node = createNodeMock();
    const asset = { kind: 'udt' as const, script: { ...validUdtScript, code_hash: '0x00' } };
    const { result } = renderHook(() => useFiberPayment(node, { asset }));

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.sendPayment('ln-udt');
      } catch (error) {
        thrown = error;
      }
    });

    expect((thrown as Error).message).toContain('code_hash must be 66 hex characters');
  });
});
