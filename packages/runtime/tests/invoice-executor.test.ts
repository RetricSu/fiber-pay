import type { FiberRpcClient } from '@fiber-pay/sdk';
import { describe, expect, it, vi } from 'vitest';
import { runInvoiceJob } from '../src/jobs/executors/invoice-executor.js';
import { defaultPaymentRetryPolicy } from '../src/jobs/retry-policy.js';
import type { InvoiceJob } from '../src/jobs/types.js';

function baseJob(overrides: Partial<InvoiceJob> = {}): InvoiceJob {
  return {
    id: 'inv-job-1',
    type: 'invoice',
    state: 'queued',
    params: {
      action: 'create',
      newInvoiceParams: { amount: '0x64', currency: 'Fibt' },
      waitForTerminal: false,
    },
    retryCount: 0,
    maxRetries: 0,
    idempotencyKey: 'inv-key-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('runInvoiceJob', () => {
  it('creates invoice and succeeds when not waiting terminal', async () => {
    const rpc = {
      newInvoice: async () => ({
        invoice_address: 'ckt1',
        invoice: {
          currency: 'Fibt',
          amount: '0x64',
          signature: '0x0',
          data: {
            timestamp: '0x1',
            payment_hash: '0xinv123',
            expiry_time: '0x3c',
            final_htlc_timeout: '0x9',
          },
          hrp: 'fibt',
          hash_algorithm: 'Sha256',
          attrs: [],
          is_expired: false,
          payee_pub_key: null,
          description: null,
          fallback_address: null,
          expiry: null,
        },
      }),
    } as unknown as FiberRpcClient;

    const states: string[] = [];
    for await (const updated of runInvoiceJob(
      baseJob(),
      rpc,
      defaultPaymentRetryPolicy,
      new AbortController().signal,
    )) {
      states.push(updated.state);
    }

    expect(states).toContain('invoice_created');
    expect(states[states.length - 1]).toBe('succeeded');
  });

  it('schedules waiting_retry on retryable create error', async () => {
    const rpc = {
      newInvoice: async () => {
        throw new Error('peer offline');
      },
    } as unknown as FiberRpcClient;

    const updates: InvoiceJob[] = [];
    const fastPolicy = { ...defaultPaymentRetryPolicy, baseDelayMs: 0, maxDelayMs: 0, jitterMs: 0 };
    for await (const updated of runInvoiceJob(
      baseJob({ maxRetries: 2 }),
      rpc,
      fastPolicy,
      new AbortController().signal,
    )) {
      updates.push(updated);
    }

    expect(updates[updates.length - 1].state).toBe('waiting_retry');
    expect(updates[updates.length - 1].retryCount).toBe(1);
    expect(updates[updates.length - 1].error?.retryable).toBe(true);
  });

  it('resumes from waiting_retry and succeeds', async () => {
    const rpc = {
      newInvoice: async () => ({
        invoice_address: 'ckt1',
        invoice: {
          currency: 'Fibt',
          amount: '0x64',
          signature: '0x0',
          data: {
            timestamp: '0x1',
            payment_hash: '0xinv456',
            expiry_time: '0x3c',
            final_htlc_timeout: '0x9',
          },
          hrp: 'fibt',
          hash_algorithm: 'Sha256',
          attrs: [],
          is_expired: false,
          payee_pub_key: null,
          description: null,
          fallback_address: null,
          expiry: null,
        },
      }),
    } as unknown as FiberRpcClient;

    const states: string[] = [];
    for await (const updated of runInvoiceJob(
      baseJob({ state: 'waiting_retry', retryCount: 1, nextRetryAt: Date.now() - 1 }),
      rpc,
      defaultPaymentRetryPolicy,
      new AbortController().signal,
    )) {
      states.push(updated.state);
    }

    expect(states[0]).toBe('executing');
    expect(states).toContain('invoice_created');
    expect(states[states.length - 1]).toBe('succeeded');
  });

  it('waits for nextRetryAt before resuming waiting_retry jobs', async () => {
    vi.useFakeTimers();
    try {
      const rpc = {
        newInvoice: async () => ({
          invoice_address: 'ckt1',
          invoice: {
            currency: 'Fibt',
            amount: '0x64',
            signature: '0x0',
            data: {
              timestamp: '0x1',
              payment_hash: '0xinv789',
              expiry_time: '0x3c',
              final_htlc_timeout: '0x9',
            },
            hrp: 'fibt',
            hash_algorithm: 'Sha256',
            attrs: [],
            is_expired: false,
            payee_pub_key: null,
            description: null,
            fallback_address: null,
            expiry: null,
          },
        }),
      } as unknown as FiberRpcClient;

      const updates: InvoiceJob[] = [];
      const consume = (async () => {
        for await (const updated of runInvoiceJob(
          baseJob({
            state: 'waiting_retry',
            retryCount: 1,
            nextRetryAt: Date.now() + 1_000,
          }),
          rpc,
          defaultPaymentRetryPolicy,
          new AbortController().signal,
        )) {
          updates.push(updated);
        }
      })();

      await vi.advanceTimersByTimeAsync(999);
      expect(updates).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      expect(updates[0]?.state).toBe('executing');

      await consume;
      expect(updates[updates.length - 1].state).toBe('succeeded');
    } finally {
      vi.useRealTimers();
    }
  });
});
