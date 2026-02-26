import type {
  Alert,
  AlertFilter,
  TrackedInvoiceState,
  TrackedPaymentState,
} from '../alerts/types.js';
import type {
  ChannelJobParams,
  InvoiceJobParams,
  JobFilter,
  PaymentJobParams,
  RuntimeJob,
} from '../jobs/types.js';

export interface RpcMonitorProxyConfig {
  listen: string;
  targetUrl: string;
}

export interface RpcMonitorProxyStatus {
  startedAt: string;
  proxyListen: string;
  targetUrl: string;
  running: boolean;
}

export interface RpcMonitorProxyDeps {
  onInvoiceTracked: (paymentHash: string) => void;
  onPaymentTracked: (paymentHash: string) => void;
  listTrackedInvoices: () => TrackedInvoiceState[];
  listTrackedPayments: () => TrackedPaymentState[];
  listAlerts: (filters?: AlertFilter) => Alert[];
  getStatus: () => RpcMonitorProxyStatus;
  createPaymentJob?: (
    params: PaymentJobParams,
    options?: { idempotencyKey?: string; maxRetries?: number },
  ) => Promise<RuntimeJob>;
  createInvoiceJob?: (
    params: InvoiceJobParams,
    options?: { idempotencyKey?: string; maxRetries?: number },
  ) => Promise<RuntimeJob>;
  createChannelJob?: (
    params: ChannelJobParams,
    options?: { idempotencyKey?: string; maxRetries?: number; reuseTerminal?: boolean },
  ) => Promise<RuntimeJob>;
  getJob?: (id: string) => RuntimeJob | undefined;
  listJobs?: (filter?: JobFilter) => RuntimeJob[];
  cancelJob?: (id: string) => void;
  listJobEvents?: (jobId: string) => unknown[];
}
