import { describe, expect, it } from 'vitest';
import { createRuntimeConfig, defaultRuntimeConfig } from '../src/config.js';

describe('createRuntimeConfig', () => {
  it('keeps defaults when top-level input fields are undefined', () => {
    const config = createRuntimeConfig({
      channelPollIntervalMs: undefined,
      invoicePollIntervalMs: undefined,
      paymentPollIntervalMs: undefined,
      peerPollIntervalMs: undefined,
      healthPollIntervalMs: undefined,
      includeClosedChannels: undefined,
      completedItemTtlSeconds: undefined,
      requestTimeoutMs: undefined,
    });

    expect(config.channelPollIntervalMs).toBe(defaultRuntimeConfig.channelPollIntervalMs);
    expect(config.invoicePollIntervalMs).toBe(defaultRuntimeConfig.invoicePollIntervalMs);
    expect(config.paymentPollIntervalMs).toBe(defaultRuntimeConfig.paymentPollIntervalMs);
    expect(config.peerPollIntervalMs).toBe(defaultRuntimeConfig.peerPollIntervalMs);
    expect(config.healthPollIntervalMs).toBe(defaultRuntimeConfig.healthPollIntervalMs);
    expect(config.includeClosedChannels).toBe(defaultRuntimeConfig.includeClosedChannels);
    expect(config.completedItemTtlSeconds).toBe(defaultRuntimeConfig.completedItemTtlSeconds);
    expect(config.requestTimeoutMs).toBe(defaultRuntimeConfig.requestTimeoutMs);
  });

  it('keeps nested defaults when nested input fields are undefined', () => {
    const config = createRuntimeConfig({
      proxy: {
        enabled: undefined,
        listen: undefined,
      },
      storage: {
        stateFilePath: undefined,
        flushIntervalMs: undefined,
        maxAlertHistory: undefined,
      },
      jobs: {
        enabled: undefined,
        dbPath: undefined,
        maxConcurrentJobs: undefined,
        schedulerIntervalMs: undefined,
        retryPolicy: {
          maxRetries: undefined,
          baseDelayMs: undefined,
          maxDelayMs: undefined,
          backoffMultiplier: undefined,
          jitterMs: undefined,
        },
      },
    });

    expect(config.proxy.enabled).toBe(defaultRuntimeConfig.proxy.enabled);
    expect(config.proxy.listen).toBe(defaultRuntimeConfig.proxy.listen);
    expect(config.storage.stateFilePath).toBe(defaultRuntimeConfig.storage.stateFilePath);
    expect(config.storage.flushIntervalMs).toBe(defaultRuntimeConfig.storage.flushIntervalMs);
    expect(config.storage.maxAlertHistory).toBe(defaultRuntimeConfig.storage.maxAlertHistory);
    expect(config.jobs.enabled).toBe(defaultRuntimeConfig.jobs.enabled);
    expect(config.jobs.dbPath).toBe(defaultRuntimeConfig.jobs.dbPath);
    expect(config.jobs.maxConcurrentJobs).toBe(defaultRuntimeConfig.jobs.maxConcurrentJobs);
    expect(config.jobs.schedulerIntervalMs).toBe(defaultRuntimeConfig.jobs.schedulerIntervalMs);
    expect(config.jobs.retryPolicy).toEqual(defaultRuntimeConfig.jobs.retryPolicy);
  });
});
