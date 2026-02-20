import type { FiberRpcClient } from '@fiber-pay/sdk';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { defaultPaymentRetryPolicy } from './retry-policy.js';
import { TERMINAL_JOB_STATES } from './types.js';
import type {
  ChannelJob,
  ChannelJobParams,
  InvoiceJob,
  InvoiceJobParams,
  JobFilter,
  JobState,
  PaymentJob,
  PaymentJobParams,
  RetryPolicy,
  RuntimeJob,
} from './types.js';
import { runPaymentJob } from './executors/payment-executor.js';
import { runInvoiceJob } from './executors/invoice-executor.js';
import { runChannelJob } from './executors/channel-executor.js';
import type { SqliteJobStore } from '../storage/sqlite-store.js';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
  return `{${entries.join(',')}}`;
}

function haveSameParams(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

export interface JobManagerEvents {
  'job:created': [job: RuntimeJob];
  'job:state_changed': [job: RuntimeJob, from: JobState];
  'job:succeeded': [job: RuntimeJob];
  'job:failed': [job: RuntimeJob];
  'job:cancelled': [job: RuntimeJob];
}

interface ActiveExecution {
  abortController: AbortController;
  promise: Promise<void>;
}

export interface JobManagerConfig {
  schedulerIntervalMs?: number;
  maxConcurrentJobs?: number;
  retryPolicy?: RetryPolicy;
}

export class JobManager extends EventEmitter<JobManagerEvents> {
  private readonly rpc: FiberRpcClient;
  private readonly store: SqliteJobStore;
  private readonly retryPolicy: RetryPolicy;
  private readonly schedulerIntervalMs: number;
  private readonly maxConcurrentJobs: number;

  private running = false;
  private schedulerTimer: ReturnType<typeof setInterval> | undefined;
  private readonly active = new Map<string, ActiveExecution>();

  constructor(rpc: FiberRpcClient, store: SqliteJobStore, config: JobManagerConfig = {}) {
    super();
    this.rpc = rpc;
    this.store = store;
    this.retryPolicy = config.retryPolicy ?? defaultPaymentRetryPolicy;
    this.schedulerIntervalMs = config.schedulerIntervalMs ?? 1000;
    this.maxConcurrentJobs = config.maxConcurrentJobs ?? 5;
  }

  async ensurePayment(
    params: PaymentJobParams,
    options: {
      idempotencyKey?: string;
      maxRetries?: number;
    } = {},
  ): Promise<PaymentJob> {
    const idempotencyKey =
      options.idempotencyKey ??
      (params.sendPaymentParams.payment_hash as string | undefined) ??
      randomUUID();

    const existing = this.store.getJobByIdempotencyKey<PaymentJobParams, PaymentJob['result']>(idempotencyKey);
    if (existing?.type === 'payment') {
      if (!haveSameParams(existing.params, params)) {
        throw new Error(
          `Idempotency key collision with different payment params: ${idempotencyKey}. Use a new idempotency key for a new payment intent.`,
        );
      }
      if (existing.state === 'succeeded' || existing.state === 'cancelled') {
        return existing as PaymentJob;
      }
      if (!TERMINAL_JOB_STATES.has(existing.state) || existing.state === 'failed') {
        if (existing.state === 'failed' && !this.active.has(existing.id)) {
          const reset = this.store.updateJob<PaymentJobParams, PaymentJob['result']>(existing.id, {
            state: 'queued',
            params,
            result: undefined,
            error: undefined,
            retryCount: 0,
            nextRetryAt: undefined,
            completedAt: undefined,
          });
          this.schedule(reset as RuntimeJob);
          return reset as PaymentJob;
        }
        return existing as PaymentJob;
      }
    }

    const job = this.store.createJob<PaymentJobParams, PaymentJob['result']>({
      type: 'payment',
      state: 'queued',
      params,
      retryCount: 0,
      maxRetries: options.maxRetries ?? this.retryPolicy.maxRetries,
      idempotencyKey,
    }) as PaymentJob;

    this.store.addJobEvent(job.id, 'created', undefined, 'queued', this.buildEventData(job));
    this.emit('job:created', job);
    this.schedule(job);
    return job;
  }

  async manageInvoice(
    params: InvoiceJobParams,
    options: { idempotencyKey?: string; maxRetries?: number; reuseTerminal?: boolean } = {},
  ): Promise<InvoiceJob> {
    const idempotencyKey = options.idempotencyKey ?? deriveInvoiceKey(params) ?? randomUUID();
    return this.createOrReuseJob<InvoiceJobParams, InvoiceJob['result']>('invoice', params, idempotencyKey, options.maxRetries, options.reuseTerminal) as Promise<InvoiceJob>;
  }

  async manageChannel(
    params: ChannelJobParams,
    options: { idempotencyKey?: string; maxRetries?: number; reuseTerminal?: boolean } = {},
  ): Promise<ChannelJob> {
    const idempotencyKey = options.idempotencyKey ?? deriveChannelKey(params) ?? randomUUID();
    return this.createOrReuseJob<ChannelJobParams, ChannelJob['result']>('channel', params, idempotencyKey, options.maxRetries, options.reuseTerminal) as Promise<ChannelJob>;
  }

  getJob(id: string): RuntimeJob | undefined {
    return this.store.getJob(id) as RuntimeJob | undefined;
  }

  listJobs(filter: JobFilter = {}): RuntimeJob[] {
    return this.store.listJobs(filter) as RuntimeJob[];
  }

  cancelJob(id: string): void {
    const job = this.getJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    if (TERMINAL_JOB_STATES.has(job.state)) return;

    this.active.get(id)?.abortController.abort();

    if (!this.active.has(id)) {
      const updated = this.store.updateJob(id, {
        state: 'cancelled',
        completedAt: Date.now(),
      }) as RuntimeJob;
      this.store.addJobEvent(id, 'cancelled', job.state, 'cancelled', this.buildEventData(updated));
      this.emit('job:cancelled', updated);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.recover();
    this.schedulerTimer = setInterval(() => this.tick(), this.schedulerIntervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = undefined;
    }
    for (const [, exec] of this.active) {
      exec.abortController.abort();
    }
    await Promise.allSettled(Array.from(this.active.values()).map((e) => e.promise));
  }

  private async createOrReuseJob<P, R>(
    type: 'invoice' | 'channel',
    params: P,
    idempotencyKey: string,
    maxRetries?: number,
    reuseTerminal?: boolean,
  ): Promise<RuntimeJob> {
    const existing = this.store.getJobByIdempotencyKey<P, R>(idempotencyKey);
    if (existing?.type === type) {
      if (!haveSameParams(existing.params, params)) {
        throw new Error(
          `Idempotency key collision with different ${type} params: ${idempotencyKey}. Use a new idempotency key for a new ${type} intent.`,
        );
      }
      if (existing.state === 'succeeded' || existing.state === 'cancelled') {
        if (reuseTerminal === false) {
          const reset = this.store.updateJob<P, R>(existing.id, {
            state: 'queued',
            params,
            result: undefined,
            error: undefined,
            retryCount: 0,
            nextRetryAt: undefined,
            completedAt: undefined,
          } as unknown as Partial<import('./types.js').Job<P, R>>);
          this.store.addJobEvent(existing.id, 'created', existing.state, 'queued', this.buildEventData(reset as RuntimeJob));
          this.emit('job:created', reset as RuntimeJob);
          this.schedule(reset as RuntimeJob);
          return reset as RuntimeJob;
        }
        return existing as RuntimeJob;
      }
      if (!TERMINAL_JOB_STATES.has(existing.state) || existing.state === 'failed') {
        if (existing.state === 'failed' && !this.active.has(existing.id)) {
          const reset = this.store.updateJob<P, R>(existing.id, {
            state: 'queued',
            params,
            result: undefined,
            error: undefined,
            retryCount: 0,
            nextRetryAt: undefined,
            completedAt: undefined,
          });
          this.schedule(reset as RuntimeJob);
          return reset as RuntimeJob;
        }
        return existing as RuntimeJob;
      }
    }

    const job = this.store.createJob<P, R>({
      type,
      state: 'queued',
      params,
      retryCount: 0,
      maxRetries: maxRetries ?? this.retryPolicy.maxRetries,
      idempotencyKey,
    }) as RuntimeJob;

    this.store.addJobEvent(job.id, 'created', undefined, 'queued', this.buildEventData(job));
    this.emit('job:created', job);
    this.schedule(job);
    return job;
  }

  private tick(): void {
    if (!this.running) return;
    if (this.active.size >= this.maxConcurrentJobs) return;

    const queued = this.store.listJobs({
      state: 'queued',
      limit: this.maxConcurrentJobs - this.active.size,
    }) as RuntimeJob[];

    for (const job of queued) {
      if (this.active.size >= this.maxConcurrentJobs) break;
      if (!this.active.has(job.id)) {
        this.execute(job);
      }
    }

    if (this.active.size < this.maxConcurrentJobs) {
      const retryable = this.store.getRetryableJobs() as RuntimeJob[];
      for (const job of retryable) {
        if (this.active.size >= this.maxConcurrentJobs) break;
        if (!this.active.has(job.id)) {
          this.execute(job);
        }
      }
    }
  }

  private schedule(job: RuntimeJob): void {
    if (this.running && this.active.size < this.maxConcurrentJobs && !this.active.has(job.id)) {
      this.execute(job);
    }
  }

  private recover(): void {
    const inProgress = this.store.getInProgressJobs() as RuntimeJob[];
    for (const job of inProgress) {
      if (this.active.size >= this.maxConcurrentJobs) break;
      let recoveredJob = job;
      if (job.type === 'payment' && (job.state === 'executing' || job.state === 'inflight')) {
        recoveredJob = this.store.updateJob<unknown, unknown>(job.id, { state: 'inflight' }) as RuntimeJob;
      }
      this.execute(recoveredJob);
    }
  }

  private execute(job: RuntimeJob): void {
    const abortController = new AbortController();

    const promise = (async () => {
      try {
        const generator =
          job.type === 'payment'
            ? runPaymentJob(job as PaymentJob, this.rpc, this.retryPolicy, abortController.signal)
            : job.type === 'invoice'
              ? runInvoiceJob(job as InvoiceJob, this.rpc, this.retryPolicy, abortController.signal)
              : runChannelJob(job as ChannelJob, this.rpc, this.retryPolicy, abortController.signal);

        for await (const updated of generator) {
          const prev = this.getJob(updated.id);
          const fromState = prev?.state ?? job.state;

          this.store.updateJob<unknown, unknown>(updated.id, updated as Partial<import('./types.js').Job>);
          this.store.addJobEvent(
            updated.id,
            stateToEvent(updated.state),
            fromState,
            updated.state,
            this.buildEventData(updated),
          );

          this.emit('job:state_changed', updated, fromState);

          if (updated.state === 'succeeded') this.emit('job:succeeded', updated);
          if (updated.state === 'failed') this.emit('job:failed', updated);
          if (updated.state === 'cancelled') this.emit('job:cancelled', updated);
        }
      } finally {
        this.active.delete(job.id);
      }
    })();

    this.active.set(job.id, { abortController, promise });
  }

  private buildEventData(job: RuntimeJob): Record<string, unknown> {
    const base: Record<string, unknown> = {
      type: job.type,
      idempotencyKey: job.idempotencyKey,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      nextRetryAt: job.nextRetryAt,
    };

    if (job.error) {
      base.error = {
        category: job.error.category,
        retryable: job.error.retryable,
        message: job.error.message,
      };
    }

    if (job.type === 'payment') {
      const paymentJob = job as PaymentJob;
      return {
        ...base,
        invoice: paymentJob.params.invoice,
        paymentHash: paymentJob.result?.paymentHash,
        paymentStatus: paymentJob.result?.status,
      };
    }

    if (job.type === 'invoice') {
      const invoiceJob = job as InvoiceJob;
      return {
        ...base,
        action: invoiceJob.params.action,
        paymentHash: invoiceJob.result?.paymentHash ?? invoiceJob.params.getInvoicePaymentHash,
        invoiceStatus: invoiceJob.result?.status,
      };
    }

    const channelJob = job as ChannelJob;
    return {
      ...base,
      action: channelJob.params.action,
      channelId:
        channelJob.params.channelId ??
        channelJob.params.shutdownChannelParams?.channel_id ??
        channelJob.result?.channelId,
      peerId: channelJob.params.peerId ?? channelJob.params.openChannelParams?.peer_id,
      channelState: channelJob.result?.state,
    };
  }
}

function deriveInvoiceKey(params: InvoiceJobParams): string | undefined {
  if (params.action === 'watch' && params.getInvoicePaymentHash) {
    return `invoice:watch:${params.getInvoicePaymentHash}`;
  }
  if (params.action === 'cancel' && params.cancelInvoiceParams?.payment_hash) {
    return `invoice:cancel:${params.cancelInvoiceParams.payment_hash}`;
  }
  if (params.action === 'settle' && params.settleInvoiceParams?.payment_hash) {
    return `invoice:settle:${params.settleInvoiceParams.payment_hash}`;
  }
  if (params.action === 'create' && params.newInvoiceParams?.payment_hash) {
    return `invoice:create:${params.newInvoiceParams.payment_hash}`;
  }
  return undefined;
}

function deriveChannelKey(params: ChannelJobParams): string | undefined {
  if (params.action === 'open') return undefined;
  if (params.acceptChannelParams?.temporary_channel_id) {
    return `channel:accept:${params.acceptChannelParams.temporary_channel_id}`;
  }
  if (params.action === 'shutdown' && params.shutdownChannelParams?.channel_id) {
    return `channel:shutdown:${params.shutdownChannelParams.channel_id}`;
  }
  if (params.action === 'abandon' && params.abandonChannelParams?.channel_id) {
    return `channel:abandon:${params.abandonChannelParams.channel_id}`;
  }
  if (params.action === 'update' && params.updateChannelParams?.channel_id) {
    const fingerprint = stableStringify(params.updateChannelParams);
    return `channel:update:${params.updateChannelParams.channel_id}:${fingerprint}`;
  }
  if (params.channelId) return `channel:${params.action}:${params.channelId}`;
  return undefined;
}

function stateToEvent(state: JobState): import('./types.js').JobEventType {
  switch (state) {
    case 'executing':
      return 'executing';
    case 'inflight':
      return 'inflight';
    case 'invoice_created':
      return 'invoice_created';
    case 'invoice_received':
      return 'invoice_received';
    case 'invoice_settled':
      return 'invoice_settled';
    case 'invoice_expired':
      return 'invoice_expired';
    case 'invoice_cancelled':
      return 'invoice_cancelled';
    case 'channel_opening':
      return 'channel_opening';
    case 'channel_accepting':
      return 'channel_accepting';
    case 'channel_abandoning':
      return 'channel_abandoning';
    case 'channel_updating':
      return 'channel_updating';
    case 'channel_awaiting_ready':
      return 'channel_awaiting_ready';
    case 'channel_ready':
      return 'channel_ready';
    case 'channel_closing':
      return 'channel_closing';
    case 'channel_closed':
      return 'channel_closed';
    case 'waiting_retry':
      return 'retry_scheduled';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'executing';
  }
}
