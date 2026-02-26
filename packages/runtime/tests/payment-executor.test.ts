import type { FiberRpcClient } from '@fiber-pay/sdk';
import { describe, expect, it } from 'vitest';
import { runPaymentJob } from '../src/jobs/executors/payment-executor.js';
import { defaultPaymentRetryPolicy } from '../src/jobs/retry-policy.js';
import type { PaymentJob, PaymentJobParams } from '../src/jobs/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type SendFn = FiberRpcClient['sendPayment'];
type GetFn = FiberRpcClient['getPayment'];

function makeJob(overrides: Partial<PaymentJob> = {}): PaymentJob {
  const params: PaymentJobParams = {
    invoice: 'test-invoice',
    sendPaymentParams: { invoice: 'test-invoice', payment_hash: '0xdeadbeef' as `0x${string}` },
  };
  return {
    id: 'job-1',
    type: 'payment',
    state: 'queued',
    params,
    retryCount: 0,
    maxRetries: 3,
    idempotencyKey: '0xdeadbeef',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeRpc(
  sendResult: Awaited<ReturnType<SendFn>>,
  getResult?: Awaited<ReturnType<GetFn>>,
): FiberRpcClient {
  return {
    sendPayment: async () => sendResult,
    getPayment: async () => getResult ?? sendResult,
  } as unknown as FiberRpcClient;
}

async function collectStates(job: PaymentJob, rpc: FiberRpcClient): Promise<string[]> {
  const states: string[] = [];
  const signal = new AbortController().signal;
  for await (const updated of runPaymentJob(job, rpc, defaultPaymentRetryPolicy, signal)) {
    states.push(updated.state);
  }
  return states;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runPaymentJob', () => {
  describe('immediate success', () => {
    it('transitions queued → executing → succeeded on immediate Success', async () => {
      const rpc = makeRpc({
        payment_hash: '0xdeadbeef',
        status: 'Success',
        fee: '0x0',
        created_at: '0x0',
        last_updated_at: '0x0',
        custom_records: undefined,
        routers: undefined,
      } as Awaited<ReturnType<SendFn>>);

      const states = await collectStates(makeJob(), rpc);
      // queued → executing → succeeded
      expect(states).toContain('executing');
      expect(states[states.length - 1]).toBe('succeeded');
    });
  });

  describe('immediate failure (permanent)', () => {
    it('ends in failed without retrying when category is non-retryable', async () => {
      const rpc = makeRpc({
        payment_hash: '0xdeadbeef',
        status: 'Failed',
        fee: '0x0',
        failed_error: 'Invoice expired',
        created_at: '0x0',
        last_updated_at: '0x0',
      } as Awaited<ReturnType<SendFn>>);

      const states = await collectStates(makeJob(), rpc);
      expect(states[states.length - 1]).toBe('failed');
      // The last state should be failed, not waiting_retry
      expect(states).not.toContain('waiting_retry');
    });
  });

  describe('retry then success', () => {
    it('retries on retryable failure and eventually succeeds', async () => {
      let callCount = 0;
      const rpc = {
        sendPayment: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              payment_hash: '0xdeadbeef',
              status: 'Failed',
              fee: '0x0',
              failed_error: 'no path found',
              created_at: '0x0',
              last_updated_at: '0x0',
            } as Awaited<ReturnType<SendFn>>;
          }
          return {
            payment_hash: '0xdeadbeef',
            status: 'Success',
            fee: '0x100',
            created_at: '0x0',
            last_updated_at: '0x0',
          } as Awaited<ReturnType<SendFn>>;
        },
        getPayment: async () =>
          ({
            payment_hash: '0xdeadbeef',
            status: 'Success',
            fee: '0x100',
            created_at: '0x0',
            last_updated_at: '0x0',
          }) as Awaited<ReturnType<GetFn>>,
      } as unknown as FiberRpcClient;

      // Use a policy with 0 jitter and minimal delays to keep test fast
      const fastPolicy = {
        ...defaultPaymentRetryPolicy,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterMs: 0,
      };
      const states: string[] = [];
      for await (const updated of runPaymentJob(
        makeJob(),
        rpc,
        fastPolicy,
        new AbortController().signal,
      )) {
        states.push(updated.state);
      }

      expect(states).toContain('waiting_retry');
      expect(states[states.length - 1]).toBe('succeeded');
    });
  });

  describe('cancellation', () => {
    it('stops when aborted while in waiting_retry', async () => {
      const abortController = new AbortController();
      const rpc = {
        sendPayment: async () => {
          abortController.abort();
          return {
            payment_hash: '0xdeadbeef',
            status: 'Failed',
            fee: '0x0',
            failed_error: 'no path found',
            created_at: '0x0',
            last_updated_at: '0x0',
          } as Awaited<ReturnType<SendFn>>;
        },
        getPayment: async () =>
          ({
            payment_hash: '0xdeadbeef',
            status: 'Failed',
            fee: '0x0',
            created_at: '0x0',
            last_updated_at: '0x0',
          }) as Awaited<ReturnType<GetFn>>,
      } as unknown as FiberRpcClient;

      const fastPolicy = {
        ...defaultPaymentRetryPolicy,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterMs: 0,
      };
      const states: string[] = [];
      for await (const updated of runPaymentJob(
        makeJob(),
        rpc,
        fastPolicy,
        abortController.signal,
      )) {
        states.push(updated.state);
      }

      expect(states[states.length - 1]).toBe('cancelled');
    });
  });

  describe('inflight polling', () => {
    it('polls get_payment when initial send returns Inflight', async () => {
      let pollCount = 0;
      const rpc = {
        sendPayment: async () =>
          ({
            payment_hash: '0xdeadbeef',
            status: 'Inflight',
            fee: '0x0',
            created_at: '0x0',
            last_updated_at: '0x0',
          }) as Awaited<ReturnType<SendFn>>,
        getPayment: async () => {
          pollCount++;
          if (pollCount < 2) {
            return {
              payment_hash: '0xdeadbeef',
              status: 'Inflight',
              fee: '0x0',
              created_at: '0x0',
              last_updated_at: '0x0',
            } as Awaited<ReturnType<GetFn>>;
          }
          return {
            payment_hash: '0xdeadbeef',
            status: 'Success',
            fee: '0x100',
            created_at: '0x0',
            last_updated_at: '0x0',
          } as Awaited<ReturnType<GetFn>>;
        },
      } as unknown as FiberRpcClient;

      // Patch POLL_INTERVAL_MS effectively by using fast abort/resume — the test just needs final state
      const states: string[] = [];
      const abortController = new AbortController();
      // Will eventually succeed since getPayment returns Success on 2nd call
      for await (const updated of runPaymentJob(
        makeJob(),
        rpc,
        { ...defaultPaymentRetryPolicy, baseDelayMs: 0, jitterMs: 0 },
        abortController.signal,
      )) {
        states.push(updated.state);
        // Stop waiting if we see inflight to avoid sleeping in tests
      }

      expect(states).toContain('inflight');
      expect(states[states.length - 1]).toBe('succeeded');
    });
  });
});
