import { act, cleanup, renderHook } from '@testing-library/react';
import type { FiberBrowserNode } from '@fiber-pay/sdk/browser';
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
});
