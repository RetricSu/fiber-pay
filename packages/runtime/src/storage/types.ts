import type { Channel, PaymentHash, PeerInfo } from '@fiber-pay/sdk';
import type {
  Alert,
  AlertFilter,
  TrackedInvoiceState,
  TrackedPaymentState,
} from '../alerts/types.js';

export interface PersistedRuntimeState {
  channels: Channel[];
  peers: PeerInfo[];
  trackedInvoices: Record<PaymentHash, TrackedInvoiceState>;
  trackedPayments: Record<PaymentHash, TrackedPaymentState>;
  alerts: Alert[];
}

export interface Store {
  load(): Promise<void>;
  flush(): Promise<void>;
  startAutoFlush(): void;
  stopAutoFlush(): void;
  pruneCompleted(ttlMs: number): void;

  getChannelSnapshot(): Channel[];
  setChannelSnapshot(channels: Channel[]): void;

  getPeerSnapshot(): PeerInfo[];
  setPeerSnapshot(peers: PeerInfo[]): void;

  addTrackedInvoice(hash: PaymentHash, status?: string): void;
  listTrackedInvoices(): TrackedInvoiceState[];
  getTrackedInvoice(hash: PaymentHash): TrackedInvoiceState | undefined;
  updateTrackedInvoice(hash: PaymentHash, status: string): void;

  addTrackedPayment(hash: PaymentHash, status?: string): void;
  listTrackedPayments(): TrackedPaymentState[];
  getTrackedPayment(hash: PaymentHash): TrackedPaymentState | undefined;
  updateTrackedPayment(hash: PaymentHash, status: string): void;

  addAlert(alert: Alert): void;
  listAlerts(filters?: AlertFilter): Alert[];
}
