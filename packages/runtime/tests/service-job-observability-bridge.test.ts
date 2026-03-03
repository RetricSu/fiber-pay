import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JobType, RuntimeJob } from '../src/jobs/types.js';
import { FiberMonitorService } from '../src/service.js';

function makeJob(type: JobType, overrides: Partial<RuntimeJob> = {}): RuntimeJob {
  const base: RuntimeJob =
    type === 'payment'
      ? ({
          id: `job-${type}`,
          type,
          state: 'queued',
          params: { sendPaymentParams: { invoice: 'fibt1...' } },
          retryCount: 0,
          maxRetries: 3,
          idempotencyKey: `idem-${type}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as RuntimeJob)
      : type === 'invoice'
        ? ({
            id: `job-${type}`,
            type,
            state: 'queued',
            params: { action: 'watch', getInvoicePaymentHash: '0xinv' },
            retryCount: 0,
            maxRetries: 3,
            idempotencyKey: `idem-${type}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as RuntimeJob)
        : ({
            id: `job-${type}`,
            type,
            state: 'queued',
            params: {
              action: 'shutdown',
              shutdownChannelParams: { channel_id: '0xchannel' },
            },
            retryCount: 0,
            maxRetries: 3,
            idempotencyKey: `idem-${type}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as RuntimeJob);

  return {
    ...base,
    ...overrides,
  } as RuntimeJob;
}

const cleanupFns: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupFns.length > 0) {
    const cleanup = cleanupFns.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

async function createService(): Promise<FiberMonitorService> {
  const dir = await mkdtemp(join(tmpdir(), 'fiber-runtime-service-bridge-'));
  const service = new FiberMonitorService({
    proxy: { enabled: false },
    storage: {
      stateFilePath: join(dir, 'runtime-state.json'),
      flushIntervalMs: 30_000,
      maxAlertHistory: 1_000,
    },
    jobs: {
      enabled: true,
      dbPath: join(dir, 'jobs.db'),
    },
  });

  cleanupFns.push(async () => {
    const jobStore = (service as unknown as { jobStore: { close: () => void } | null }).jobStore;
    jobStore?.close();
    await rm(dir, { recursive: true, force: true });
  });

  return service;
}

describe('FiberMonitorService job observability bridge', () => {
  it('maps payment/invoice/channel job lifecycle events to alerts', async () => {
    const service = await createService();
    const manager = (
      service as unknown as {
        jobManager: { emit: (event: string, ...args: unknown[]) => void } | null;
      }
    ).jobManager;

    expect(manager).toBeTruthy();

    const jobTypes: JobType[] = ['payment', 'invoice', 'channel'];
    for (const type of jobTypes) {
      manager?.emit('job:created', makeJob(type));
      manager?.emit(
        'job:state_changed',
        makeJob(type, { state: 'waiting_retry', retryCount: 1 }),
        'executing',
      );
      manager?.emit('job:succeeded', makeJob(type, { state: 'succeeded' }));
      manager?.emit(
        'job:failed',
        makeJob(type, {
          state: 'failed',
          error: { category: 'unknown', retryable: false, message: 'boom' },
        }),
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 0));

    const alerts = service.listAlerts();
    const types = new Set(alerts.map((alert) => alert.type));

    expect(types.has('payment_job_started')).toBe(true);
    expect(types.has('payment_job_retrying')).toBe(true);
    expect(types.has('payment_job_succeeded')).toBe(true);
    expect(types.has('payment_job_failed')).toBe(true);

    expect(types.has('invoice_job_started')).toBe(true);
    expect(types.has('invoice_job_retrying')).toBe(true);
    expect(types.has('invoice_job_succeeded')).toBe(true);
    expect(types.has('invoice_job_failed')).toBe(true);

    expect(types.has('channel_job_started')).toBe(true);
    expect(types.has('channel_job_retrying')).toBe(true);
    expect(types.has('channel_job_succeeded')).toBe(true);
    expect(types.has('channel_job_failed')).toBe(true);

    const paymentFailed = alerts.find((alert) => alert.type === 'payment_job_failed');
    expect(paymentFailed?.source).toBe('job-manager');
    expect(paymentFailed?.priority).toBe('high');
  });

  it('auto-tracks payment/invoice hashes from job events', async () => {
    const service = await createService();
    const manager = (
      service as unknown as {
        jobManager: { emit: (event: string, ...args: unknown[]) => void } | null;
      }
    ).jobManager;

    expect(manager).toBeTruthy();

    manager?.emit(
      'job:state_changed',
      makeJob('payment', {
        state: 'inflight',
        params: {
          sendPaymentParams: {
            invoice: 'fibt1...',
            payment_hash: '0xpaymenthash',
          },
        },
      }),
      'executing',
    );

    manager?.emit(
      'job:succeeded',
      makeJob('invoice', {
        state: 'succeeded',
        result: {
          paymentHash: '0xinvoicehash',
          status: 'Open',
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const trackedPayments = service.listTrackedPayments();
    const trackedInvoices = service.listTrackedInvoices();

    expect(trackedPayments.some((item) => item.paymentHash === '0xpaymenthash')).toBe(true);
    expect(trackedInvoices.some((item) => item.paymentHash === '0xinvoicehash')).toBe(true);
  });

  it('includes channel peer and temporary identifiers in channel job alerts', async () => {
    const service = await createService();
    const manager = (
      service as unknown as {
        jobManager: { emit: (event: string, ...args: unknown[]) => void } | null;
      }
    ).jobManager;

    expect(manager).toBeTruthy();

    manager?.emit(
      'job:created',
      makeJob('channel', {
        params: {
          action: 'open',
          peerId: 'peer-open-1',
          openChannelParams: {
            peer_id: 'peer-open-1',
            funding_amount: '0x64',
          },
        },
      }),
    );

    manager?.emit(
      'job:succeeded',
      makeJob('channel', {
        state: 'succeeded',
        params: {
          action: 'open',
          peerId: 'peer-open-1',
          openChannelParams: {
            peer_id: 'peer-open-1',
            funding_amount: '0x64',
          },
        },
        result: {
          temporaryChannelId: '0xtmp-open-1',
          channelId: '0xchannel-open-1',
          state: 'CHANNEL_READY',
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const started = service.listAlerts().find((alert) => alert.type === 'channel_job_started');
    expect(started?.data).toMatchObject({
      action: 'open',
      peerId: 'peer-open-1',
      fundingAmount: '0x64',
    });

    const succeeded = service.listAlerts().find((alert) => alert.type === 'channel_job_succeeded');
    expect(succeeded?.data).toMatchObject({
      action: 'open',
      peerId: 'peer-open-1',
      temporaryChannelId: '0xtmp-open-1',
      channelId: '0xchannel-open-1',
      fundingAmount: '0x64',
    });
  });
});
