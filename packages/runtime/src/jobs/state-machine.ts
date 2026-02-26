import type { JobState } from './types.js';

// ─── State Machine ────────────────────────────────────────────────────────────

export type MachineEvent =
  | 'send_issued'
  | 'payment_inflight'
  | 'payment_success'
  | 'payment_failed_retryable'
  | 'payment_failed_permanent'
  | 'invoice_created'
  | 'invoice_received'
  | 'invoice_settled'
  | 'invoice_expired'
  | 'invoice_cancelled'
  | 'channel_opening'
  | 'channel_accepting'
  | 'channel_abandoning'
  | 'channel_updating'
  | 'channel_closing'
  | 'channel_ready'
  | 'channel_closed'
  | 'channel_failed'
  | 'retry_delay_elapsed'
  | 'cancel';

interface Transition {
  from: JobState | JobState[];
  event: MachineEvent;
  to: JobState;
}

const PAYMENT_TRANSITIONS: Transition[] = [
  { from: 'queued', event: 'send_issued', to: 'executing' },
  { from: 'executing', event: 'payment_inflight', to: 'inflight' },
  { from: 'executing', event: 'payment_success', to: 'succeeded' },
  { from: 'executing', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'executing', event: 'payment_failed_permanent', to: 'failed' },
  { from: 'inflight', event: 'payment_success', to: 'succeeded' },
  { from: 'inflight', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'inflight', event: 'payment_failed_permanent', to: 'failed' },
  { from: 'waiting_retry', event: 'retry_delay_elapsed', to: 'executing' },
  {
    from: ['queued', 'executing', 'inflight', 'waiting_retry'],
    event: 'cancel',
    to: 'cancelled',
  },
];

const INVOICE_TRANSITIONS: Transition[] = [
  { from: 'queued', event: 'send_issued', to: 'executing' },
  { from: 'executing', event: 'invoice_created', to: 'invoice_created' },
  { from: 'invoice_created', event: 'payment_success', to: 'succeeded' },
  { from: 'executing', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'invoice_created', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'invoice_active', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'invoice_received', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'waiting_retry', event: 'retry_delay_elapsed', to: 'executing' },
  { from: 'invoice_created', event: 'invoice_received', to: 'invoice_received' },
  { from: 'invoice_created', event: 'invoice_settled', to: 'invoice_settled' },
  { from: 'invoice_active', event: 'invoice_received', to: 'invoice_received' },
  { from: 'invoice_active', event: 'invoice_settled', to: 'invoice_settled' },
  { from: 'invoice_active', event: 'invoice_expired', to: 'invoice_expired' },
  { from: 'invoice_active', event: 'invoice_cancelled', to: 'invoice_cancelled' },
  { from: 'invoice_received', event: 'invoice_settled', to: 'invoice_settled' },
  {
    from: ['invoice_created', 'invoice_received'],
    event: 'invoice_expired',
    to: 'invoice_expired',
  },
  {
    from: ['invoice_created', 'invoice_received'],
    event: 'invoice_cancelled',
    to: 'invoice_cancelled',
  },
  {
    from: ['invoice_settled', 'invoice_expired', 'invoice_cancelled'],
    event: 'payment_success',
    to: 'succeeded',
  },
  {
    from: ['invoice_expired', 'invoice_cancelled'],
    event: 'payment_failed_permanent',
    to: 'failed',
  },
  {
    from: ['executing', 'invoice_created', 'invoice_active', 'invoice_received'],
    event: 'payment_failed_permanent',
    to: 'failed',
  },
  {
    from: [
      'queued',
      'executing',
      'waiting_retry',
      'invoice_created',
      'invoice_active',
      'invoice_received',
    ],
    event: 'cancel',
    to: 'cancelled',
  },
];

const CHANNEL_TRANSITIONS: Transition[] = [
  { from: 'queued', event: 'send_issued', to: 'executing' },
  { from: 'executing', event: 'channel_opening', to: 'channel_opening' },
  { from: 'executing', event: 'channel_accepting', to: 'channel_accepting' },
  { from: 'executing', event: 'channel_abandoning', to: 'channel_abandoning' },
  { from: 'executing', event: 'channel_updating', to: 'channel_updating' },
  { from: 'channel_opening', event: 'payment_success', to: 'succeeded' },
  { from: 'channel_accepting', event: 'payment_success', to: 'succeeded' },
  { from: 'channel_abandoning', event: 'payment_success', to: 'succeeded' },
  { from: 'channel_updating', event: 'payment_success', to: 'succeeded' },
  { from: 'executing', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'channel_opening', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'channel_accepting', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'channel_abandoning', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'channel_updating', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'channel_awaiting_ready', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'channel_closing', event: 'payment_failed_retryable', to: 'waiting_retry' },
  { from: 'executing', event: 'payment_failed_permanent', to: 'failed' },
  { from: 'channel_opening', event: 'payment_failed_permanent', to: 'failed' },
  { from: 'channel_accepting', event: 'payment_failed_permanent', to: 'failed' },
  { from: 'channel_abandoning', event: 'payment_failed_permanent', to: 'failed' },
  { from: 'channel_updating', event: 'payment_failed_permanent', to: 'failed' },
  { from: 'channel_awaiting_ready', event: 'payment_failed_permanent', to: 'failed' },
  { from: 'channel_closing', event: 'payment_failed_permanent', to: 'failed' },
  { from: ['executing', 'channel_ready'], event: 'channel_closing', to: 'channel_closing' },
  { from: 'waiting_retry', event: 'retry_delay_elapsed', to: 'executing' },
  { from: 'channel_opening', event: 'channel_opening', to: 'channel_awaiting_ready' },
  { from: 'channel_awaiting_ready', event: 'channel_opening', to: 'channel_awaiting_ready' },
  { from: 'channel_opening', event: 'channel_ready', to: 'channel_ready' },
  { from: 'channel_awaiting_ready', event: 'channel_ready', to: 'channel_ready' },
  { from: ['channel_opening', 'channel_ready'], event: 'channel_closed', to: 'channel_closed' },
  { from: 'channel_awaiting_ready', event: 'channel_closed', to: 'channel_closed' },
  { from: 'channel_closing', event: 'channel_closed', to: 'channel_closed' },
  { from: 'channel_closing', event: 'payment_success', to: 'succeeded' },
  { from: 'channel_closed', event: 'payment_failed_permanent', to: 'failed' },
  { from: ['channel_ready', 'channel_opening'], event: 'channel_failed', to: 'failed' },
  { from: ['channel_ready', 'channel_closed'], event: 'payment_success', to: 'succeeded' },
  {
    from: [
      'queued',
      'executing',
      'waiting_retry',
      'channel_opening',
      'channel_accepting',
      'channel_abandoning',
      'channel_updating',
      'channel_awaiting_ready',
      'channel_ready',
      'channel_closing',
    ],
    event: 'cancel',
    to: 'cancelled',
  },
];

export class JobStateMachine {
  private readonly table: Map<string, JobState>;

  constructor(transitions: Transition[]) {
    this.table = new Map();
    for (const t of transitions) {
      const froms = Array.isArray(t.from) ? t.from : [t.from];
      for (const from of froms) {
        this.table.set(`${from}:${t.event}`, t.to);
      }
    }
  }

  transition(current: JobState, event: MachineEvent): JobState | null {
    return this.table.get(`${current}:${event}`) ?? null;
  }

  isTerminal(state: JobState): boolean {
    return state === 'succeeded' || state === 'failed' || state === 'cancelled';
  }
}

export const paymentStateMachine = new JobStateMachine(PAYMENT_TRANSITIONS);
export const invoiceStateMachine = new JobStateMachine(INVOICE_TRANSITIONS);
export const channelStateMachine = new JobStateMachine(CHANNEL_TRANSITIONS);
