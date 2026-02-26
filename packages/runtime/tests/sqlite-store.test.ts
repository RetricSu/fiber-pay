import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaymentJob, PaymentJobParams } from '../src/jobs/types.js';
import { SqliteJobStore } from '../src/storage/sqlite-store.js';

let store: SqliteJobStore;
let dbPath: string;

beforeEach(() => {
  const dir = join(tmpdir(), `fiber-pay-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = join(dir, 'test.db');
  store = new SqliteJobStore(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(dbPath, { force: true });
});

const baseParams: PaymentJobParams = {
  sendPaymentParams: { invoice: 'test-invoice' },
};

describe('SqliteJobStore', () => {
  describe('createJob', () => {
    it('creates a job and returns it with an id', () => {
      const job = store.createJob<PaymentJobParams, PaymentJob['result']>({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'abc123',
      });

      expect(job.id).toBeTruthy();
      expect(job.state).toBe('queued');
      expect(job.idempotencyKey).toBe('abc123');
      expect(job.createdAt).toBeGreaterThan(0);
    });

    it('throws on duplicate idempotency key', () => {
      store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'dup',
      });
      expect(() =>
        store.createJob({
          type: 'payment',
          state: 'queued',
          params: baseParams,
          retryCount: 0,
          maxRetries: 3,
          idempotencyKey: 'dup',
        }),
      ).toThrow();
    });
  });

  describe('getJob / getJobByIdempotencyKey', () => {
    it('returns job by id', () => {
      const created = store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'idem1',
      });
      const found = store.getJob(created.id);
      expect(found?.id).toBe(created.id);
    });

    it('returns undefined for missing id', () => {
      expect(store.getJob('nonexistent')).toBeUndefined();
    });

    it('returns job by idempotency key', () => {
      store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'lookup-key',
      });
      const found = store.getJobByIdempotencyKey('lookup-key');
      expect(found?.idempotencyKey).toBe('lookup-key');
    });
  });

  describe('updateJob', () => {
    it('updates state and result', () => {
      const created = store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'upd1',
      });
      const updated = store.updateJob<PaymentJobParams, PaymentJob['result']>(created.id, {
        state: 'succeeded',
        result: { paymentHash: '0xabc', status: 'Success', fee: '0x0' },
        completedAt: Date.now(),
      });
      expect(updated.state).toBe('succeeded');
      expect(updated.result?.paymentHash).toBe('0xabc');

      const refetched = store.getJob(created.id);
      expect(refetched?.state).toBe('succeeded');
    });
  });

  describe('listJobs', () => {
    it('returns all jobs with no filter', () => {
      store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'l1',
      });
      store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'l2',
      });
      expect(store.listJobs().length).toBe(2);
    });

    it('filters by state', () => {
      store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'fs1',
      });
      const j2 = store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'fs2',
      });
      store.updateJob(j2.id, { state: 'succeeded' });

      const queued = store.listJobs({ state: 'queued' });
      expect(queued.length).toBe(1);
      expect(queued[0].idempotencyKey).toBe('fs1');
    });

    it('filters by multiple states', () => {
      store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'ms1',
      });
      const j2 = store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'ms2',
      });
      store.updateJob(j2.id, { state: 'failed' });

      const active = store.listJobs({ state: ['queued', 'failed'] });
      expect(active.length).toBe(2);
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        store.createJob({
          type: 'payment',
          state: 'queued',
          params: baseParams,
          retryCount: 0,
          maxRetries: 3,
          idempotencyKey: `lim${i}`,
        });
      }
      expect(store.listJobs({ limit: 3 }).length).toBe(3);
    });
  });

  describe('getRetryableJobs', () => {
    it('returns jobs in waiting_retry state with next_retry_at <= now', () => {
      const j = store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'ret1',
      });
      store.updateJob(j.id, { state: 'waiting_retry', nextRetryAt: Date.now() - 1000 });

      const ready = store.getRetryableJobs();
      expect(ready.length).toBe(1);
    });

    it('does not return jobs whose next_retry_at is in the future', () => {
      const j = store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'ret2',
      });
      store.updateJob(j.id, { state: 'waiting_retry', nextRetryAt: Date.now() + 60_000 });

      expect(store.getRetryableJobs().length).toBe(0);
    });
  });

  describe('job events', () => {
    it('stores and retrieves job events', () => {
      const j = store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'ev1',
      });
      store.addJobEvent(j.id, 'created', undefined, 'queued');
      store.addJobEvent(j.id, 'executing', 'queued', 'executing');

      const events = store.listJobEvents(j.id);
      expect(events.length).toBe(2);
      expect(events[0].eventType).toBe('created');
      expect(events[1].fromState).toBe('queued');
      expect(events[1].toState).toBe('executing');
    });
  });

  describe('getInProgressJobs', () => {
    it('returns only non-terminal jobs', () => {
      const j1 = store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'ip1',
      });
      const j2 = store.createJob({
        type: 'payment',
        state: 'queued',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'ip2',
      });
      const j3 = store.createJob({
        type: 'invoice',
        state: 'invoice_active',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'ip3',
      });
      const j4 = store.createJob({
        type: 'channel',
        state: 'channel_opening',
        params: baseParams,
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: 'ip4',
      });
      store.updateJob(j2.id, { state: 'succeeded' });

      const inProgress = store.getInProgressJobs();
      const ids = inProgress.map((job) => job.id);
      expect(ids).toContain(j1.id);
      expect(ids).toContain(j3.id);
      expect(ids).toContain(j4.id);
      expect(ids).not.toContain(j2.id);
    });
  });
});
