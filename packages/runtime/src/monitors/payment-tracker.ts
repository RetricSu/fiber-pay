import type { FiberRpcClient } from '@fiber-pay/sdk';
import type { AlertManager } from '../alerts/alert-manager.js';
import type { Store } from '../storage/types.js';
import { BaseMonitor, type BaseMonitorHooks } from './base-monitor.js';
import { isExpectedTrackerError } from './tracker-utils.js';

export interface PaymentTrackerConfig {
  intervalMs: number;
  completedItemTtlSeconds: number;
}

export class PaymentTracker extends BaseMonitor {
  protected get name(): string {
    return 'payment-tracker';
  }

  private readonly client: FiberRpcClient;
  private readonly store: Store;
  private readonly alerts: AlertManager;
  private readonly config: PaymentTrackerConfig;

  constructor(options: {
    client: FiberRpcClient;
    store: Store;
    alerts: AlertManager;
    config: PaymentTrackerConfig;
    hooks?: BaseMonitorHooks;
  }) {
    super(options.config.intervalMs, options.hooks);
    this.client = options.client;
    this.store = options.store;
    this.alerts = options.alerts;
    this.config = options.config;
  }

  protected async poll(): Promise<void> {
    const tracked = this.store.listTrackedPayments();

    for (const payment of tracked) {
      if (isTerminalPaymentStatus(payment.status)) {
        continue;
      }

      try {
        const next = await this.client.getPayment({ payment_hash: payment.paymentHash });
        const previousStatus = payment.status;
        const currentStatus = next.status;

        if (currentStatus !== previousStatus) {
          this.store.updateTrackedPayment(payment.paymentHash, currentStatus);

          if (currentStatus === 'Success') {
            await this.alerts.emit({
              type: 'outgoing_payment_completed',
              priority: 'medium',
              source: this.name,
              data: {
                paymentHash: payment.paymentHash,
                previousStatus,
                currentStatus,
                payment: next,
              },
            });
          }

          if (currentStatus === 'Failed') {
            await this.alerts.emit({
              type: 'outgoing_payment_failed',
              priority: 'high',
              source: this.name,
              data: {
                paymentHash: payment.paymentHash,
                previousStatus,
                currentStatus,
                payment: next,
              },
            });
          }
        }
      } catch (error) {
        if (isExpectedTrackerError(error)) {
          continue;
        }
        throw error;
      }
    }

    this.store.pruneCompleted(this.config.completedItemTtlSeconds * 1000);
  }
}

function isTerminalPaymentStatus(status: string): boolean {
  return status === 'Success' || status === 'Failed';
}
