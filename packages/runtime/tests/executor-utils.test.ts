import { describe, expect, it } from 'vitest';
import { applyRetryOrFail } from '../src/jobs/executor-utils.js';
import type { ClassifiedError, RetryPolicy } from '../src/jobs/types.js';

const retryableError: ClassifiedError = {
  category: 'temporary_failure',
  retryable: true,
  message: 'temporary failure',
};

const retryPolicy: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 1,
  jitterMs: 0,
};

describe('applyRetryOrFail', () => {
  it('uses job.maxRetries instead of global policy maxRetries', () => {
    const job = {
      state: 'executing' as const,
      retryCount: 0,
      maxRetries: 1,
      updatedAt: Date.now(),
    };

    const first = applyRetryOrFail(job, retryableError, retryPolicy);
    expect(first.state).toBe('waiting_retry');
    expect(first.retryCount).toBe(1);

    const second = applyRetryOrFail(first, retryableError, retryPolicy);
    expect(second.state).toBe('failed');
    expect(second.retryCount).toBe(1);
  });
});
