import { resolve } from 'node:path';
import { defaultPaymentRetryPolicy } from './jobs/retry-policy.js';
import type { RetryPolicy } from './jobs/types.js';

export interface StdoutAlertConfig {
  type: 'stdout';
}

export interface WebhookAlertConfig {
  type: 'webhook';
  url: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface WebsocketAlertConfig {
  type: 'websocket';
  listen: string;
}

export interface FileAlertConfig {
  type: 'file';
  path: string;
}

export interface DailyFileAlertConfig {
  type: 'daily-file';
  baseLogsDir: string;
  filename?: string;
}

export type AlertBackendConfig =
  | StdoutAlertConfig
  | WebhookAlertConfig
  | WebsocketAlertConfig
  | FileAlertConfig
  | DailyFileAlertConfig;

export interface RuntimeConfig {
  fiberRpcUrl: string;
  channelPollIntervalMs: number;
  invoicePollIntervalMs: number;
  paymentPollIntervalMs: number;
  peerPollIntervalMs: number;
  healthPollIntervalMs: number;
  includeClosedChannels: boolean;
  completedItemTtlSeconds: number;
  requestTimeoutMs: number;
  alerts: AlertBackendConfig[];
  proxy: {
    enabled: boolean;
    listen: string;
  };
  storage: {
    stateFilePath: string;
    flushIntervalMs: number;
    maxAlertHistory: number;
  };
  jobs: {
    /** Enable the payment job execution engine. Default: false */
    enabled: boolean;
    /** Path to the SQLite file for job persistence. Default: derived from storage.stateFilePath */
    dbPath: string;
    maxConcurrentJobs: number;
    schedulerIntervalMs: number;
    retryPolicy: RetryPolicy;
  };
}

export type RuntimeConfigInput = Omit<Partial<RuntimeConfig>, 'proxy' | 'storage' | 'jobs'> & {
  proxy?: Partial<RuntimeConfig['proxy']>;
  storage?: Partial<RuntimeConfig['storage']>;
  jobs?: Partial<RuntimeConfig['jobs']>;
};

export const defaultRuntimeConfig: RuntimeConfig = {
  fiberRpcUrl: 'http://127.0.0.1:8227',
  channelPollIntervalMs: 5000,
  invoicePollIntervalMs: 3000,
  paymentPollIntervalMs: 2000,
  peerPollIntervalMs: 15000,
  healthPollIntervalMs: 10000,
  includeClosedChannels: false,
  completedItemTtlSeconds: 86400,
  requestTimeoutMs: 10000,
  alerts: [{ type: 'stdout' }],
  proxy: {
    enabled: true,
    listen: '127.0.0.1:8229',
  },
  storage: {
    stateFilePath: resolve(process.cwd(), '.fiber-pay-runtime-state.json'),
    flushIntervalMs: 30000,
    maxAlertHistory: 5000,
  },
  jobs: {
    enabled: true,
    dbPath: resolve(process.cwd(), '.fiber-pay-jobs.db'),
    maxConcurrentJobs: 5,
    schedulerIntervalMs: 1000,
    retryPolicy: defaultPaymentRetryPolicy,
  },
};

export function createRuntimeConfig(input: RuntimeConfigInput = {}): RuntimeConfig {
  const config: RuntimeConfig = {
    fiberRpcUrl: input.fiberRpcUrl ?? defaultRuntimeConfig.fiberRpcUrl,
    channelPollIntervalMs:
      input.channelPollIntervalMs ?? defaultRuntimeConfig.channelPollIntervalMs,
    invoicePollIntervalMs:
      input.invoicePollIntervalMs ?? defaultRuntimeConfig.invoicePollIntervalMs,
    paymentPollIntervalMs:
      input.paymentPollIntervalMs ?? defaultRuntimeConfig.paymentPollIntervalMs,
    peerPollIntervalMs: input.peerPollIntervalMs ?? defaultRuntimeConfig.peerPollIntervalMs,
    healthPollIntervalMs: input.healthPollIntervalMs ?? defaultRuntimeConfig.healthPollIntervalMs,
    includeClosedChannels:
      input.includeClosedChannels ?? defaultRuntimeConfig.includeClosedChannels,
    completedItemTtlSeconds:
      input.completedItemTtlSeconds ?? defaultRuntimeConfig.completedItemTtlSeconds,
    requestTimeoutMs: input.requestTimeoutMs ?? defaultRuntimeConfig.requestTimeoutMs,
    proxy: {
      enabled: input.proxy?.enabled ?? defaultRuntimeConfig.proxy.enabled,
      listen: input.proxy?.listen ?? defaultRuntimeConfig.proxy.listen,
    },
    storage: {
      stateFilePath: input.storage?.stateFilePath ?? defaultRuntimeConfig.storage.stateFilePath,
      flushIntervalMs:
        input.storage?.flushIntervalMs ?? defaultRuntimeConfig.storage.flushIntervalMs,
      maxAlertHistory:
        input.storage?.maxAlertHistory ?? defaultRuntimeConfig.storage.maxAlertHistory,
    },
    jobs: {
      enabled: input.jobs?.enabled ?? defaultRuntimeConfig.jobs.enabled,
      dbPath: input.jobs?.dbPath ?? defaultRuntimeConfig.jobs.dbPath,
      maxConcurrentJobs:
        input.jobs?.maxConcurrentJobs ?? defaultRuntimeConfig.jobs.maxConcurrentJobs,
      schedulerIntervalMs:
        input.jobs?.schedulerIntervalMs ?? defaultRuntimeConfig.jobs.schedulerIntervalMs,
      retryPolicy: {
        maxRetries:
          input.jobs?.retryPolicy?.maxRetries ?? defaultRuntimeConfig.jobs.retryPolicy.maxRetries,
        baseDelayMs:
          input.jobs?.retryPolicy?.baseDelayMs ?? defaultRuntimeConfig.jobs.retryPolicy.baseDelayMs,
        maxDelayMs:
          input.jobs?.retryPolicy?.maxDelayMs ?? defaultRuntimeConfig.jobs.retryPolicy.maxDelayMs,
        backoffMultiplier:
          input.jobs?.retryPolicy?.backoffMultiplier ??
          defaultRuntimeConfig.jobs.retryPolicy.backoffMultiplier,
        jitterMs:
          input.jobs?.retryPolicy?.jitterMs ?? defaultRuntimeConfig.jobs.retryPolicy.jitterMs,
      },
    },
    alerts: input.alerts ?? defaultRuntimeConfig.alerts,
  };

  if (!config.fiberRpcUrl) {
    throw new Error('Runtime config requires fiberRpcUrl');
  }
  if (!config.proxy.listen) {
    throw new Error('Runtime config requires proxy.listen');
  }
  if (config.channelPollIntervalMs <= 0 || config.invoicePollIntervalMs <= 0) {
    throw new Error('Polling intervals must be > 0');
  }
  if (config.paymentPollIntervalMs <= 0 || config.peerPollIntervalMs <= 0) {
    throw new Error('Polling intervals must be > 0');
  }
  if (config.healthPollIntervalMs <= 0) {
    throw new Error('healthPollIntervalMs must be > 0');
  }
  if (config.completedItemTtlSeconds < 0) {
    throw new Error('completedItemTtlSeconds must be >= 0');
  }
  if (config.storage.flushIntervalMs <= 0) {
    throw new Error('storage.flushIntervalMs must be > 0');
  }
  if (config.storage.maxAlertHistory <= 0) {
    throw new Error('storage.maxAlertHistory must be > 0');
  }
  if (!config.jobs.dbPath) {
    throw new Error('jobs.dbPath is required');
  }
  if (config.jobs.maxConcurrentJobs <= 0) {
    throw new Error('jobs.maxConcurrentJobs must be > 0');
  }
  if (config.jobs.schedulerIntervalMs <= 0) {
    throw new Error('jobs.schedulerIntervalMs must be > 0');
  }
  if (config.jobs.retryPolicy.maxRetries < 0) {
    throw new Error('jobs.retryPolicy.maxRetries must be >= 0');
  }
  if (config.jobs.retryPolicy.baseDelayMs < 0) {
    throw new Error('jobs.retryPolicy.baseDelayMs must be >= 0');
  }
  if (config.jobs.retryPolicy.maxDelayMs < 0) {
    throw new Error('jobs.retryPolicy.maxDelayMs must be >= 0');
  }

  return config;
}

export function parseListenAddress(listen: string): { host: string; port: number } {
  const [host, portText] = listen.split(':');
  const port = Number(portText);
  if (!host || Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid listen address: ${listen}`);
  }
  return { host, port };
}
