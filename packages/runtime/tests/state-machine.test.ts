import { describe, expect, it } from 'vitest';
import {
  channelStateMachine,
  invoiceStateMachine,
  paymentStateMachine,
} from '../src/jobs/state-machine.js';
import type { JobState } from '../src/jobs/types.js';

describe('JobStateMachine', () => {
  it('allows valid transitions', () => {
    expect(paymentStateMachine.transition('queued', 'send_issued')).toBe('executing');
    expect(paymentStateMachine.transition('executing', 'payment_inflight')).toBe('inflight');
    expect(paymentStateMachine.transition('executing', 'payment_success')).toBe('succeeded');
    expect(paymentStateMachine.transition('inflight', 'payment_success')).toBe('succeeded');
    expect(paymentStateMachine.transition('executing', 'payment_failed_retryable')).toBe(
      'waiting_retry',
    );
    expect(paymentStateMachine.transition('inflight', 'payment_failed_permanent')).toBe('failed');
    expect(paymentStateMachine.transition('waiting_retry', 'retry_delay_elapsed')).toBe(
      'executing',
    );
  });

  it('returns null for invalid transitions', () => {
    expect(paymentStateMachine.transition('succeeded', 'send_issued')).toBeNull();
    expect(paymentStateMachine.transition('failed', 'retry_delay_elapsed')).toBeNull();
    expect(paymentStateMachine.transition('queued', 'payment_success')).toBeNull();
  });

  it('identifies terminal states correctly', () => {
    const terminal: JobState[] = ['succeeded', 'failed', 'cancelled'];
    for (const s of terminal) {
      expect(paymentStateMachine.isTerminal(s)).toBe(true);
    }
    const nonTerminal: JobState[] = ['queued', 'executing', 'inflight', 'waiting_retry'];
    for (const s of nonTerminal) {
      expect(paymentStateMachine.isTerminal(s)).toBe(false);
    }
  });

  it('allows cancel from any active state', () => {
    const active: JobState[] = ['queued', 'executing', 'inflight', 'waiting_retry'];
    for (const s of active) {
      expect(paymentStateMachine.transition(s, 'cancel')).toBe('cancelled');
    }
  });

  it('does not allow cancel from terminal states', () => {
    const terminal: JobState[] = ['succeeded', 'failed', 'cancelled'];
    for (const s of terminal) {
      expect(paymentStateMachine.transition(s, 'cancel')).toBeNull();
    }
  });

  it('supports invoice waiting_retry transitions', () => {
    expect(invoiceStateMachine.transition('executing', 'payment_failed_retryable')).toBe(
      'waiting_retry',
    );
    expect(invoiceStateMachine.transition('waiting_retry', 'retry_delay_elapsed')).toBe(
      'executing',
    );
    expect(invoiceStateMachine.transition('waiting_retry', 'cancel')).toBe('cancelled');
  });

  it('supports channel waiting_retry transitions', () => {
    expect(channelStateMachine.transition('executing', 'payment_failed_retryable')).toBe(
      'waiting_retry',
    );
    expect(channelStateMachine.transition('channel_opening', 'payment_failed_retryable')).toBe(
      'waiting_retry',
    );
    expect(channelStateMachine.transition('channel_accepting', 'payment_failed_retryable')).toBe(
      'waiting_retry',
    );
    expect(channelStateMachine.transition('channel_abandoning', 'payment_failed_retryable')).toBe(
      'waiting_retry',
    );
    expect(channelStateMachine.transition('channel_updating', 'payment_failed_retryable')).toBe(
      'waiting_retry',
    );
    expect(channelStateMachine.transition('waiting_retry', 'retry_delay_elapsed')).toBe(
      'executing',
    );
    expect(channelStateMachine.transition('waiting_retry', 'cancel')).toBe('cancelled');
  });

  it('supports channel permanent failure transitions from active channel states', () => {
    expect(channelStateMachine.transition('executing', 'payment_failed_permanent')).toBe('failed');
    expect(channelStateMachine.transition('channel_opening', 'payment_failed_permanent')).toBe(
      'failed',
    );
    expect(channelStateMachine.transition('channel_accepting', 'payment_failed_permanent')).toBe(
      'failed',
    );
    expect(channelStateMachine.transition('channel_abandoning', 'payment_failed_permanent')).toBe(
      'failed',
    );
    expect(channelStateMachine.transition('channel_updating', 'payment_failed_permanent')).toBe(
      'failed',
    );
    expect(
      channelStateMachine.transition('channel_awaiting_ready', 'payment_failed_permanent'),
    ).toBe('failed');
    expect(channelStateMachine.transition('channel_closing', 'payment_failed_permanent')).toBe(
      'failed',
    );
  });

  it('supports channel accept/abandon/update success transitions', () => {
    expect(channelStateMachine.transition('executing', 'channel_accepting')).toBe(
      'channel_accepting',
    );
    expect(channelStateMachine.transition('channel_accepting', 'payment_success')).toBe(
      'succeeded',
    );

    expect(channelStateMachine.transition('executing', 'channel_abandoning')).toBe(
      'channel_abandoning',
    );
    expect(channelStateMachine.transition('channel_abandoning', 'payment_success')).toBe(
      'succeeded',
    );

    expect(channelStateMachine.transition('executing', 'channel_updating')).toBe(
      'channel_updating',
    );
    expect(channelStateMachine.transition('channel_updating', 'payment_success')).toBe('succeeded');
  });
});
