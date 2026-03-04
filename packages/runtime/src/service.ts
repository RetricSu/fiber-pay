import { EventEmitter } from 'node:events';
import { FiberRpcClient } from '@fiber-pay/sdk';
import { AlertManager } from './alerts/alert-manager.js';
import { DailyJsonlFileAlertBackend, JsonlFileAlertBackend } from './alerts/backends/file-jsonl.js';
import { StdoutAlertBackend } from './alerts/backends/stdout.js';
import { WebhookAlertBackend } from './alerts/backends/webhook.js';
import { WebsocketAlertBackend } from './alerts/backends/websocket.js';
import type {
  Alert,
  AlertBackend,
  AlertFilter,
  AlertType,
  ChannelJobAlertData,
  InvoiceJobAlertData,
  PaymentJobAlertData,
} from './alerts/types.js';
import { createRuntimeConfig, type RuntimeConfig, type RuntimeConfigInput } from './config.js';
import { JobManager } from './jobs/job-manager.js';
import type { ChannelJob, InvoiceJob, PaymentJob, RuntimeJob } from './jobs/types.js';
import type { BaseMonitor } from './monitors/base-monitor.js';
import { ChannelMonitor } from './monitors/channel-monitor.js';
import { HealthMonitor } from './monitors/health-monitor.js';
import { InvoiceTracker } from './monitors/invoice-tracker.js';
import { PaymentTracker } from './monitors/payment-tracker.js';
import { PeerMonitor } from './monitors/peer-monitor.js';
import { RpcMonitorProxy } from './proxy/rpc-proxy.js';
import { MemoryStore } from './storage/memory-store.js';
import { SqliteJobStore } from './storage/sqlite-store.js';

export class FiberMonitorService extends EventEmitter {
  private readonly config: RuntimeConfig;
  private readonly startedAt: string;
  private readonly client: FiberRpcClient;
  private readonly store: MemoryStore;
  private readonly alerts: AlertManager;
  private readonly monitors: BaseMonitor[];
  private readonly proxy: RpcMonitorProxy;
  private readonly jobStore: SqliteJobStore | null;
  private readonly jobManager: JobManager | null;
  private running = false;

  constructor(configInput: RuntimeConfigInput = {}) {
    super();
    this.config = createRuntimeConfig(configInput);
    this.startedAt = new Date().toISOString();

    this.client = new FiberRpcClient({
      url: this.config.fiberRpcUrl,
      timeout: this.config.requestTimeoutMs,
    });

    this.store = new MemoryStore({
      stateFilePath: this.config.storage.stateFilePath,
      flushIntervalMs: this.config.storage.flushIntervalMs,
      maxAlertHistory: this.config.storage.maxAlertHistory,
    });

    this.alerts = new AlertManager({
      backends: this.createAlertBackends(this.config),
      store: this.store,
    });

    this.jobStore = this.config.jobs.enabled ? new SqliteJobStore(this.config.jobs.dbPath) : null;
    this.jobManager = this.jobStore
      ? new JobManager(this.client, this.jobStore, {
          maxConcurrentJobs: this.config.jobs.maxConcurrentJobs,
          schedulerIntervalMs: this.config.jobs.schedulerIntervalMs,
          retryPolicy: this.config.jobs.retryPolicy,
        })
      : null;

    this.wireJobAlerts();

    const hooks = {};

    this.monitors = [
      new ChannelMonitor({
        client: this.client,
        store: this.store,
        alerts: this.alerts,
        config: {
          intervalMs: this.config.channelPollIntervalMs,
          includeClosedChannels: this.config.includeClosedChannels,
        },
        hooks,
      }),
      new InvoiceTracker({
        client: this.client,
        store: this.store,
        alerts: this.alerts,
        config: {
          intervalMs: this.config.invoicePollIntervalMs,
          completedItemTtlSeconds: this.config.completedItemTtlSeconds,
        },
        hooks,
      }),
      new PaymentTracker({
        client: this.client,
        store: this.store,
        alerts: this.alerts,
        config: {
          intervalMs: this.config.paymentPollIntervalMs,
          completedItemTtlSeconds: this.config.completedItemTtlSeconds,
        },
        hooks,
      }),
      new PeerMonitor({
        client: this.client,
        store: this.store,
        alerts: this.alerts,
        config: { intervalMs: this.config.peerPollIntervalMs },
        hooks,
      }),
      new HealthMonitor({
        client: this.client,
        alerts: this.alerts,
        config: { intervalMs: this.config.healthPollIntervalMs },
      }),
    ];

    this.alerts.onEmit((alert) => {
      this.emit('alert', alert);
    });

    const jobManager = this.jobManager;
    const jobStore = this.jobStore;

    this.proxy = new RpcMonitorProxy(
      {
        listen: this.config.proxy.listen,
        targetUrl: this.config.fiberRpcUrl,
      },
      {
        onInvoiceTracked: (paymentHash) => {
          this.store.addTrackedInvoice(paymentHash as `0x${string}`);
        },
        onPaymentTracked: (paymentHash) => {
          this.store.addTrackedPayment(paymentHash as `0x${string}`);
        },
        listTrackedInvoices: () => this.store.listTrackedInvoices(),
        listTrackedPayments: () => this.store.listTrackedPayments(),
        listAlerts: (filters) => this.store.listAlerts(filters),
        getStatus: () => this.getStatus(),
        createPaymentJob: jobManager
          ? (params, options) => jobManager.ensurePayment(params, options)
          : undefined,
        createInvoiceJob: jobManager
          ? (params, options) => jobManager.manageInvoice(params, options)
          : undefined,
        createChannelJob: jobManager
          ? (params, options) => jobManager.manageChannel(params, options)
          : undefined,
        getJob: jobManager ? (id) => jobManager.getJob(id) : undefined,
        listJobs: jobManager ? (filter) => jobManager.listJobs(filter) : undefined,
        cancelJob: jobManager ? (id) => jobManager.cancelJob(id) : undefined,
        listJobEvents: jobStore ? (jobId) => jobStore.listJobEvents(jobId) : undefined,
      },
    );
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    await this.store.load();
    this.store.startAutoFlush();
    await this.alerts.start();

    for (const monitor of this.monitors) {
      monitor.start();
    }

    this.jobManager?.start();

    if (this.config.proxy.enabled) {
      await this.proxy.start();
    }

    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    for (const monitor of this.monitors) {
      monitor.stop();
    }

    await this.jobManager?.stop();

    if (this.config.proxy.enabled) {
      await this.proxy.stop();
    }

    this.store.stopAutoFlush();
    await this.store.flush();
    await this.alerts.stop();
    this.jobStore?.close();
    this.running = false;
  }

  getStatus(): {
    startedAt: string;
    proxyListen: string;
    targetUrl: string;
    running: boolean;
  } {
    return {
      startedAt: this.startedAt,
      proxyListen: this.config.proxy.listen,
      targetUrl: this.config.fiberRpcUrl,
      running: this.running,
    };
  }

  listAlerts(filters?: AlertFilter): Alert[] {
    return this.store.listAlerts(filters);
  }

  listTrackedInvoices() {
    return this.store.listTrackedInvoices();
  }

  listTrackedPayments() {
    return this.store.listTrackedPayments();
  }

  trackInvoice(paymentHash: `0x${string}`): void {
    this.store.addTrackedInvoice(paymentHash);
  }

  trackPayment(paymentHash: `0x${string}`): void {
    this.store.addTrackedPayment(paymentHash);
  }

  private createAlertBackends(config: RuntimeConfig): AlertBackend[] {
    return config.alerts.map((alertConfig) => {
      if (alertConfig.type === 'stdout') {
        return new StdoutAlertBackend();
      }
      if (alertConfig.type === 'webhook') {
        return new WebhookAlertBackend({
          url: alertConfig.url,
          timeoutMs: alertConfig.timeoutMs,
          headers: alertConfig.headers,
        });
      }
      if (alertConfig.type === 'file') {
        return new JsonlFileAlertBackend(alertConfig.path);
      }
      if (alertConfig.type === 'daily-file') {
        return new DailyJsonlFileAlertBackend(alertConfig.baseLogsDir, alertConfig.filename);
      }
      const [host, portText] = alertConfig.listen.split(':');
      return new WebsocketAlertBackend({
        host,
        port: Number(portText),
      });
    });
  }

  private wireJobAlerts(): void {
    if (!this.jobManager) {
      return;
    }

    this.jobManager.on('job:created', (job) => {
      this.emitJobAlert(job, 'started', 'low');
      this.trackJobArtifacts(job);
    });

    this.jobManager.on('job:state_changed', (job) => {
      this.trackJobArtifacts(job);
      if (job.state === 'waiting_retry') {
        this.emitJobAlert(job, 'retrying', 'medium');
      }
    });

    this.jobManager.on('job:succeeded', (job) => {
      this.trackJobArtifacts(job);
      this.emitJobAlert(job, 'succeeded', 'medium');
    });

    this.jobManager.on('job:failed', (job) => {
      this.trackJobArtifacts(job);
      this.emitJobAlert(job, 'failed', 'high');
    });
  }

  private emitJobAlert(
    job: RuntimeJob,
    lifecycle: 'started' | 'retrying' | 'succeeded' | 'failed',
    priority: 'low' | 'medium' | 'high',
  ): void {
    const type = this.toJobAlertType(job.type, lifecycle);
    const data = this.toJobAlertData(job);
    void this.alerts.emit({
      type,
      priority,
      source: 'job-manager',
      data,
    });
  }

  private toJobAlertType(
    jobType: RuntimeJob['type'],
    lifecycle: 'started' | 'retrying' | 'succeeded' | 'failed',
  ): AlertType {
    return `${jobType}_job_${lifecycle}` as AlertType;
  }

  private toJobAlertData(
    job: RuntimeJob,
  ): PaymentJobAlertData | InvoiceJobAlertData | ChannelJobAlertData {
    const error = job.error?.message;

    if (job.type === 'payment') {
      const paymentJob = job as PaymentJob;
      return {
        jobId: paymentJob.id,
        idempotencyKey: paymentJob.idempotencyKey,
        retryCount: paymentJob.retryCount,
        error,
        fee: paymentJob.result?.fee,
      };
    }

    if (job.type === 'invoice') {
      const invoiceJob = job as InvoiceJob;
      return {
        jobId: invoiceJob.id,
        idempotencyKey: invoiceJob.idempotencyKey,
        retryCount: invoiceJob.retryCount,
        action: invoiceJob.params.action,
        status: invoiceJob.result?.status,
        paymentHash: this.extractInvoiceHash(invoiceJob),
        error,
      };
    }

    const channelJob = job as ChannelJob;
    return {
      jobId: channelJob.id,
      idempotencyKey: channelJob.idempotencyKey,
      retryCount: channelJob.retryCount,
      action: channelJob.params.action,
      peerId: this.extractChannelPeerId(channelJob),
      temporaryChannelId: this.extractTemporaryChannelId(channelJob),
      channelId: this.extractChannelId(channelJob),
      fundingAmount: this.extractChannelFundingAmount(channelJob),
      error,
    };
  }

  private trackJobArtifacts(job: RuntimeJob): void {
    if (job.type === 'payment') {
      const paymentHash = this.extractPaymentHash(job);
      if (paymentHash) {
        this.store.addTrackedPayment(paymentHash);
      }
      return;
    }

    if (job.type === 'invoice') {
      const paymentHash = this.extractInvoiceHash(job);
      if (paymentHash) {
        this.store.addTrackedInvoice(paymentHash);
      }
    }
  }

  private extractPaymentHash(job: PaymentJob): `0x${string}` | undefined {
    return this.normalizeHash(job.result?.paymentHash ?? job.params.sendPaymentParams.payment_hash);
  }

  private extractInvoiceHash(job: InvoiceJob): `0x${string}` | undefined {
    return this.normalizeHash(
      job.result?.paymentHash ??
        job.params.getInvoicePaymentHash ??
        job.params.cancelInvoiceParams?.payment_hash ??
        job.params.settleInvoiceParams?.payment_hash ??
        job.params.newInvoiceParams?.payment_hash,
    );
  }

  private extractChannelId(job: ChannelJob): `0x${string}` | undefined {
    return this.normalizeHash(
      job.result?.channelId ??
        job.result?.acceptedChannelId ??
        job.params.channelId ??
        job.params.shutdownChannelParams?.channel_id,
    );
  }

  private extractChannelPeerId(job: ChannelJob): string | undefined {
    return job.params.peerId ?? job.params.openChannelParams?.peer_id;
  }

  private extractTemporaryChannelId(job: ChannelJob): `0x${string}` | undefined {
    return this.normalizeHash(
      job.result?.temporaryChannelId ?? job.params.acceptChannelParams?.temporary_channel_id,
    );
  }

  private extractChannelFundingAmount(job: ChannelJob): string | undefined {
    return job.params.openChannelParams?.funding_amount;
  }

  private normalizeHash(value: string | undefined): `0x${string}` | undefined {
    if (!value || !value.startsWith('0x')) {
      return undefined;
    }
    return value as `0x${string}`;
  }
}
