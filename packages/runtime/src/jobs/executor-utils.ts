import { computeRetryDelay, shouldRetry } from './retry-policy.js';
import type { JobStateMachine, MachineEvent } from './state-machine.js';
import type { ClassifiedError, JobState, RetryPolicy } from './types.js';

type RetryableJobShape = {
  state: JobState;
  error?: ClassifiedError;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: number;
  updatedAt: number;
  completedAt?: number;
};

export function transitionJobState<T extends { state: JobState; updatedAt: number; completedAt?: number }>(
  job: T,
  machine: JobStateMachine,
  event: MachineEvent,
  options?: {
    now?: number;
    patch?: Partial<T>;
  },
): T {
  const nextState = machine.transition(job.state, event);
  if (!nextState) {
    throw new Error(`Invalid state transition: ${job.state} --${event}--> ?`);
  }

  const now = options?.now ?? Date.now();
  return {
    ...job,
    ...(options?.patch ?? {}),
    state: nextState,
    updatedAt: now,
    completedAt: machine.isTerminal(nextState) ? now : job.completedAt,
  } as T;
}

export function applyRetryOrFail<T extends RetryableJobShape>(
  job: T,
  classifiedError: ClassifiedError,
  policy: RetryPolicy,
  options?: {
    now?: number;
    failedPatch?: Partial<T>;
    machine?: JobStateMachine;
    retryEvent?: MachineEvent;
    failEvent?: MachineEvent;
  },
): T {
  const now = options?.now ?? Date.now();

  const effectivePolicy: RetryPolicy = {
    ...policy,
    maxRetries: job.maxRetries,
  };

  if (shouldRetry(classifiedError, job.retryCount, effectivePolicy)) {
    const delay = computeRetryDelay(job.retryCount, effectivePolicy);
    const retryTransition =
      options?.machine && options.retryEvent
        ? transitionJobState(job, options.machine, options.retryEvent, { now })
        : ({ ...job, state: 'waiting_retry', updatedAt: now } as T);

    return {
      ...retryTransition,
      error: classifiedError,
      retryCount: job.retryCount + 1,
      nextRetryAt: now + delay,
    } as T;
  }

  const failTransition =
    options?.machine && options.failEvent
      ? transitionJobState(job, options.machine, options.failEvent, { now })
      : ({ ...job, state: 'failed', completedAt: now, updatedAt: now } as T);

  return {
    ...failTransition,
    error: classifiedError,
    ...(options?.failedPatch ?? {}),
  } as T;
}
