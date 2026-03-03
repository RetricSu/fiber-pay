import type { Channel, ChannelId, PaymentHash, PeerInfo } from '@fiber-pay/sdk';

export type AlertPriority = 'critical' | 'high' | 'medium' | 'low';

export type AlertType =
  | 'channel_state_changed'
  | 'new_inbound_channel_request'
  | 'channel_became_ready'
  | 'channel_closing'
  | 'incoming_payment_received'
  | 'invoice_expired'
  | 'invoice_cancelled'
  | 'outgoing_payment_completed'
  | 'outgoing_payment_failed'
  | 'channel_balance_changed'
  | 'new_pending_tlc'
  | 'peer_connected'
  | 'peer_disconnected'
  | 'node_offline'
  | 'node_online'
  // Job execution alerts
  | 'payment_job_started'
  | 'payment_job_retrying'
  | 'payment_job_succeeded'
  | 'payment_job_failed'
  | 'invoice_job_started'
  | 'invoice_job_retrying'
  | 'invoice_job_succeeded'
  | 'invoice_job_failed'
  | 'channel_job_started'
  | 'channel_job_retrying'
  | 'channel_job_succeeded'
  | 'channel_job_failed';

export const alertTypeValues: AlertType[] = [
  'channel_state_changed',
  'new_inbound_channel_request',
  'channel_became_ready',
  'channel_closing',
  'incoming_payment_received',
  'invoice_expired',
  'invoice_cancelled',
  'outgoing_payment_completed',
  'outgoing_payment_failed',
  'channel_balance_changed',
  'new_pending_tlc',
  'peer_connected',
  'peer_disconnected',
  'node_offline',
  'node_online',
  'payment_job_started',
  'payment_job_retrying',
  'payment_job_succeeded',
  'payment_job_failed',
  'invoice_job_started',
  'invoice_job_retrying',
  'invoice_job_succeeded',
  'invoice_job_failed',
  'channel_job_started',
  'channel_job_retrying',
  'channel_job_succeeded',
  'channel_job_failed',
];

export const alertPriorityOrder: Record<AlertPriority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export interface AlertFilter {
  limit?: number;
  minPriority?: AlertPriority;
  type?: AlertType;
  source?: string;
}

export function isAlertPriority(value: string): value is AlertPriority {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low';
}

export function isAlertType(value: string): value is AlertType {
  return alertTypeValues.includes(value as AlertType);
}

export interface Alert<T = unknown> {
  id: string;
  type: AlertType;
  priority: AlertPriority;
  timestamp: string;
  source: string;
  data: T;
}

export interface AlertInput<T = unknown> {
  type: AlertType;
  priority: AlertPriority;
  source: string;
  data: T;
}

export interface TrackedInvoiceState {
  paymentHash: PaymentHash;
  status: string;
  trackedAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface TrackedPaymentState {
  paymentHash: PaymentHash;
  status: string;
  trackedAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ChannelBalanceChangedData {
  channelId: ChannelId;
  localBalanceBefore: string;
  localBalanceAfter: string;
  remoteBalanceBefore: string;
  remoteBalanceAfter: string;
  channel: Channel;
}

export interface PendingTlcChangedData {
  channelId: ChannelId;
  newPendingTlcCount: number;
  previousPendingTlcCount: number;
  channel: Channel;
}

export interface ChannelStateChangedData {
  channelId: ChannelId;
  previousState: string;
  currentState: string;
  channel: Channel;
}

export interface PeerEventData {
  peer: PeerInfo;
}

export interface RpcHealthData {
  message: string;
}

export interface PaymentJobAlertData {
  jobId: string;
  idempotencyKey: string;
  retryCount: number;
  error?: string;
  fee?: string;
}

export interface InvoiceJobAlertData {
  jobId: string;
  idempotencyKey: string;
  retryCount: number;
  action?: string;
  status?: string;
  paymentHash?: `0x${string}`;
  error?: string;
}

export interface ChannelJobAlertData {
  jobId: string;
  idempotencyKey: string;
  retryCount: number;
  action?: string;
  peerId?: string;
  temporaryChannelId?: `0x${string}`;
  channelId?: `0x${string}`;
  fundingAmount?: string;
  error?: string;
}

export interface AlertBackend {
  start?(): Promise<void>;
  send(alert: Alert): Promise<void>;
  stop?(): Promise<void>;
}
