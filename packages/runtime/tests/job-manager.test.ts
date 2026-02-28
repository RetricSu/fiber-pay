import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FiberRpcClient } from '@fiber-pay/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobManager } from '../src/jobs/job-manager.js';
import type { ChannelJobParams, PaymentJobParams } from '../src/jobs/types.js';
import { SqliteJobStore } from '../src/storage/sqlite-store.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

let store: SqliteJobStore;
let manager: JobManager;
let dbPath: string;

const successRpc = {
  sendPayment: async () => ({
    payment_hash: '0xabc123',
    status: 'Success',
    fee: '0x0',
    created_at: '0x0',
    last_updated_at: '0x0',
  }),
  getPayment: async () => ({
    payment_hash: '0xabc123',
    status: 'Success',
    fee: '0x0',
    created_at: '0x0',
    last_updated_at: '0x0',
  }),
  newInvoice: async () => ({
    invoice_address: 'ckt1invoice',
    invoice: {
      currency: 'fibt',
      amount: '0x64',
      signature: '0x00',
      data: {
        timestamp: '0x1',
        payment_hash: '0xinv123',
        expiry_time: '0x3c',
        final_htlc_timeout: '0x9',
      },
      hrp: 'fibt',
      hash_algorithm: 'sha256',
      attrs: [],
      is_expired: false,
      payee_pub_key: null,
      description: null,
      fallback_address: null,
      expiry: null,
    },
  }),
  getInvoice: async () => ({
    invoice_address: 'ckt1invoice',
    status: 'Paid',
    invoice: {
      currency: 'fibt',
      amount: '0x64',
      signature: '0x00',
      data: {
        timestamp: '0x1',
        payment_hash: '0xinv123',
        expiry_time: '0x3c',
        final_htlc_timeout: '0x9',
      },
      hrp: 'fibt',
      hash_algorithm: 'sha256',
      attrs: [],
      is_expired: false,
      payee_pub_key: null,
      description: null,
      fallback_address: null,
      expiry: null,
    },
  }),
  cancelInvoice: async () => ({
    invoice_address: 'ckt1invoice',
    status: 'Cancelled',
    invoice: {
      currency: 'fibt',
      amount: '0x64',
      signature: '0x00',
      data: {
        timestamp: '0x1',
        payment_hash: '0xinv123',
        expiry_time: '0x3c',
        final_htlc_timeout: '0x9',
      },
      hrp: 'fibt',
      hash_algorithm: 'sha256',
      attrs: [],
      is_expired: false,
      payee_pub_key: null,
      description: null,
      fallback_address: null,
      expiry: null,
    },
  }),
  settleInvoice: async () => null,
  openChannel: async () => ({ temporary_channel_id: '0xtmp1' }),
  shutdownChannel: async () => null,
  listChannels: async () => ({
    channels: [
      {
        channel_id: '0xchan1',
        is_public: false,
        is_acceptor: false,
        is_one_way: false,
        channel_outpoint: null,
        peer_id: 'peer-1',
        funding_udt_type_script: null,
        state: { state_name: 'CHANNEL_READY' },
        local_balance: '0x0',
        offered_tlc_balance: '0x0',
        remote_balance: '0x0',
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
  }),
} as unknown as FiberRpcClient;

const testParams: PaymentJobParams = {
  sendPaymentParams: { invoice: 'some-invoice', payment_hash: '0xabc123' as `0x${string}` },
};

beforeEach(() => {
  const dir = join(tmpdir(), `fiber-pay-jm-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = join(dir, 'jobs.db');
  store = new SqliteJobStore(dbPath);
  manager = new JobManager(successRpc, store, {
    schedulerIntervalMs: 50,
    retryPolicy: {
      maxRetries: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      backoffMultiplier: 1,
      jitterMs: 0,
    },
  });
  manager.start();
});

afterEach(async () => {
  await manager.stop();
  store.close();
  rmSync(dbPath, { force: true });
});

function waitFor<T extends object>(emitter: T, event: string, timeout = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    // @ts-expect-error EventEmitter typed via generics
    emitter.once(event, (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args[0]);
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('JobManager', () => {
  describe('ensurePayment', () => {
    it('creates and runs a payment job to success', async () => {
      const succeededPromise = waitFor(manager, 'job:succeeded');
      const job = await manager.ensurePayment(testParams, { idempotencyKey: 'key-1' });

      expect(job.id).toBeTruthy();
      expect(job.type).toBe('payment');

      const succeeded = (await succeededPromise) as { state: string };
      expect(succeeded.state).toBe('succeeded');
    });

    it('returns same job on duplicate idempotency key (idempotent)', async () => {
      const job1 = await manager.ensurePayment(testParams, { idempotencyKey: 'idem-1' });
      // Wait for first job to complete by polling
      await new Promise<void>((resolve) => {
        const check = () => {
          const j = manager.getJob(job1.id);
          if (j?.state === 'succeeded') {
            resolve();
            return;
          }
          setTimeout(check, 20);
        };
        check();
      });

      // Now calling ensurePayment with same key should return the same job
      const job2 = await manager.ensurePayment(testParams, { idempotencyKey: 'idem-1' });
      expect(job2.id).toBe(job1.id);
    });

    it('emits job:created event', async () => {
      const createdPromise = waitFor(manager, 'job:created');
      await manager.ensurePayment(testParams, { idempotencyKey: 'ev-1' });
      const created = await createdPromise;
      expect((created as { state: string }).state).toBe('queued');
    });

    it('throws when reusing same idempotency key with different payment params', async () => {
      await manager.ensurePayment(testParams, { idempotencyKey: 'pay-collision-1' });

      await expect(
        manager.ensurePayment(
          {
            sendPaymentParams: {
              invoice: 'different-invoice',
              payment_hash: '0xabc123' as `0x${string}`,
            },
          },
          { idempotencyKey: 'pay-collision-1' },
        ),
      ).rejects.toThrow(/Idempotency key collision/i);
    });
  });

  describe('getJob', () => {
    it('returns the job by id', async () => {
      const job = await manager.ensurePayment(testParams, { idempotencyKey: 'gj-1' });
      const found = manager.getJob(job.id);
      expect(found?.id).toBe(job.id);
    });

    it('returns undefined for unknown id', () => {
      expect(manager.getJob('nonexistent')).toBeUndefined();
    });
  });

  describe('listJobs', () => {
    it('lists jobs matching filter', async () => {
      await manager.ensurePayment(testParams, { idempotencyKey: 'lj-1' });
      const jobs = manager.listJobs({ type: 'payment' });
      expect(jobs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('manageInvoice', () => {
    it('creates and completes invoice job', async () => {
      const job = await manager.manageInvoice(
        {
          action: 'create',
          newInvoiceParams: {
            amount: '0x64',
            currency: 'fibt',
          },
          waitForTerminal: false,
        },
        { idempotencyKey: 'inv-1' },
      );

      expect(job.type).toBe('invoice');
      await new Promise((r) => setTimeout(r, 100));
      const final = manager.getJob(job.id);
      expect(final?.state).toBe('succeeded');
    });

    it('throws when same idempotency key is reused for a different invoice action', async () => {
      await manager.manageInvoice(
        {
          action: 'cancel',
          cancelInvoiceParams: { payment_hash: '0xinv123' as `0x${string}` },
        },
        { idempotencyKey: 'invoice-collision-1' },
      );

      await expect(
        manager.manageInvoice(
          {
            action: 'settle',
            settleInvoiceParams: {
              payment_hash: '0xinv123' as `0x${string}`,
              payment_preimage: '0x01' as `0x${string}`,
            },
          },
          { idempotencyKey: 'invoice-collision-1' },
        ),
      ).rejects.toThrow(/Idempotency key collision/i);
    });
  });

  describe('manageChannel', () => {
    it('creates and completes channel open job', async () => {
      const job = await manager.manageChannel(
        {
          action: 'open',
          openChannelParams: {
            peer_id: 'peer-1',
            funding_amount: '0x64',
          },
          waitForReady: true,
        },
        { idempotencyKey: 'chan-1' },
      );

      expect(job.type).toBe('channel');
      await new Promise((r) => setTimeout(r, 100));
      const final = manager.getJob(job.id);
      expect(final?.state).toBe('succeeded');
    });
  });

  describe('cancelJob', () => {
    it('cancels a queued job before it executes', async () => {
      // Use a slow RPC to prevent immediate execution
      const slowRpc = {
        sendPayment: () => new Promise((r) => setTimeout(r, 10_000)),
        getPayment: () => new Promise((r) => setTimeout(r, 10_000)),
      } as unknown as FiberRpcClient;

      const slowStore = new SqliteJobStore(dbPath.replace('.db', '-slow.db'));
      const slowManager = new JobManager(slowRpc, slowStore, {
        schedulerIntervalMs: 10_000, // don't auto-run
      });
      // Don't start — job stays queued

      try {
        const job = await slowManager.ensurePayment(testParams, { idempotencyKey: 'cancel-1' });
        slowManager.cancelJob(job.id);
        const updated = slowManager.getJob(job.id);
        expect(updated?.state).toBe('cancelled');
      } finally {
        await slowManager.stop();
        slowStore.close();
        rmSync(dbPath.replace('.db', '-slow.db'), { force: true });
      }
    });
  });

  describe('reuseTerminal', () => {
    it('returns stale succeeded job when reuseTerminal is not set (default)', async () => {
      const channelParams: ChannelJobParams = {
        action: 'open',
        openChannelParams: { peer_id: 'peer-1', funding_amount: '0x64' },
        waitForReady: true,
      };

      const job1 = await manager.manageChannel(channelParams, { idempotencyKey: 'reuse-default' });
      // Wait for job to succeed
      await new Promise<void>((resolve) => {
        const check = () => {
          const j = manager.getJob(job1.id);
          if (j?.state === 'succeeded') {
            resolve();
            return;
          }
          setTimeout(check, 20);
        };
        check();
      });

      // Same key, default reuseTerminal (undefined) → returns stale succeeded job
      const job2 = await manager.manageChannel(channelParams, { idempotencyKey: 'reuse-default' });
      expect(job2.id).toBe(job1.id);
      expect(job2.state).toBe('succeeded');
    });

    it('resets succeeded job when reuseTerminal is false', async () => {
      const channelParams: ChannelJobParams = {
        action: 'open',
        openChannelParams: { peer_id: 'peer-1', funding_amount: '0x64' },
        waitForReady: true,
      };

      const job1 = await manager.manageChannel(channelParams, { idempotencyKey: 'reuse-false' });
      // Wait for job to succeed
      await new Promise<void>((resolve) => {
        const check = () => {
          const j = manager.getJob(job1.id);
          if (j?.state === 'succeeded') {
            resolve();
            return;
          }
          setTimeout(check, 20);
        };
        check();
      });

      const succeededJob = manager.getJob(job1.id);
      expect(succeededJob?.state).toBe('succeeded');

      // Same key, reuseTerminal: false → job should be reset to queued
      const job2 = await manager.manageChannel(channelParams, {
        idempotencyKey: 'reuse-false',
        reuseTerminal: false,
      });
      expect(job2.id).toBe(job1.id);
      expect(job2.state).toBe('queued');

      // Wait for re-execution
      await new Promise<void>((resolve) => {
        const check = () => {
          const j = manager.getJob(job2.id);
          if (j?.state === 'succeeded') {
            resolve();
            return;
          }
          setTimeout(check, 20);
        };
        check();
      });

      const final = manager.getJob(job2.id);
      expect(final?.state).toBe('succeeded');
    });

    it('still deduplicates non-terminal jobs even when reuseTerminal is false', async () => {
      // Don't start manager so jobs stay in queued state (non-terminal)
      const noStartStore = new SqliteJobStore(dbPath.replace('.db', '-nostart.db'));
      const noStartManager = new JobManager(successRpc, noStartStore, {
        schedulerIntervalMs: 10_000,
      });
      // Deliberately not calling start() — jobs will stay queued

      try {
        const channelParams: ChannelJobParams = {
          action: 'open',
          openChannelParams: { peer_id: 'peer-dedup', funding_amount: '0x64' },
          waitForReady: false,
        };

        const job1 = await noStartManager.manageChannel(channelParams, {
          idempotencyKey: 'reuse-inflight',
          reuseTerminal: false,
        });
        expect(job1.state).toBe('queued');

        // Second call with same key while job is still queued → should return same job (dedup)
        const job2 = await noStartManager.manageChannel(channelParams, {
          idempotencyKey: 'reuse-inflight',
          reuseTerminal: false,
        });

        expect(job2.id).toBe(job1.id);
        expect(job2.state).toBe('queued');
      } finally {
        await noStartManager.stop();
        noStartStore.close();
        rmSync(dbPath.replace('.db', '-nostart.db'), { force: true });
      }
    });
  });
});
