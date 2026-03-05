import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FiberRpcClient } from '@fiber-pay/sdk';
import { FiberRpcError } from '@fiber-pay/sdk';
import { describe, expect, it } from 'vitest';
import { AlertManager } from '../src/alerts/alert-manager.js';
import type { Alert, AlertBackend } from '../src/alerts/types.js';
import { PaymentTracker } from '../src/monitors/payment-tracker.js';
import { MemoryStore } from '../src/storage/memory-store.js';

class CaptureAlertBackend implements AlertBackend {
  constructor(private readonly alerts: Alert[]) {}

  async send(alert: Alert): Promise<void> {
    this.alerts.push(alert);
  }
}

describe('PaymentTracker', () => {
  it('does not poll terminal tracked payments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fiber-payment-tracker-'));
    const store = new MemoryStore({
      stateFilePath: join(dir, 'runtime-state.json'),
      flushIntervalMs: 1000,
      maxAlertHistory: 100,
    });
    store.addTrackedPayment('0xpay-terminal', 'Success');

    const emitted: Alert[] = [];
    const alerts = new AlertManager({
      backends: [new CaptureAlertBackend(emitted)],
      store,
    });

    let getPaymentCalls = 0;
    const client = {
      getPayment: async () => {
        getPaymentCalls++;
        return {
          payment_hash: '0xpay-terminal',
          status: 'Success',
          fee: '0x0',
          created_at: '0x0',
          last_updated_at: '0x0',
        };
      },
    };

    const tracker = new PaymentTracker({
      client: client as unknown as FiberRpcClient,
      store,
      alerts,
      config: {
        intervalMs: 1000,
        completedItemTtlSeconds: 60,
      },
    });

    await (tracker as unknown as { poll: () => Promise<void> }).poll();

    expect(getPaymentCalls).toBe(0);
    expect(emitted).toHaveLength(0);
    await rm(dir, { recursive: true, force: true });
  });

  it('emits outgoing_payment_failed when tracked payment transitions to Failed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fiber-payment-tracker-'));
    const store = new MemoryStore({
      stateFilePath: join(dir, 'runtime-state.json'),
      flushIntervalMs: 1000,
      maxAlertHistory: 100,
    });
    store.addTrackedPayment('0xpay-failed', 'Inflight');

    const emitted: Alert[] = [];
    const alerts = new AlertManager({
      backends: [new CaptureAlertBackend(emitted)],
      store,
    });

    const client = {
      getPayment: async () => ({
        payment_hash: '0xpay-failed',
        status: 'Failed',
        fee: '0x0',
        failed_error: 'no path found',
        created_at: '0x0',
        last_updated_at: '0x0',
      }),
    };

    const tracker = new PaymentTracker({
      client: client as unknown as FiberRpcClient,
      store,
      alerts,
      config: {
        intervalMs: 1000,
        completedItemTtlSeconds: 60,
      },
    });

    await (tracker as unknown as { poll: () => Promise<void> }).poll();

    expect(emitted.some((item) => item.type === 'outgoing_payment_failed')).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('marks payment as Failed when RPC not-found appears in error data payload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fiber-payment-tracker-'));
    const store = new MemoryStore({
      stateFilePath: join(dir, 'runtime-state.json'),
      flushIntervalMs: 1000,
      maxAlertHistory: 100,
    });
    store.addTrackedPayment('0xpay-missing', 'Created');

    const emitted: Alert[] = [];
    const alerts = new AlertManager({
      backends: [new CaptureAlertBackend(emitted)],
      store,
    });

    const client = {
      getPayment: async () => {
        throw new FiberRpcError(-32602, 'InvalidParameter', {
          details: 'Payment session not found: Hash256(0xpay-missing)',
        });
      },
    };

    const tracker = new PaymentTracker({
      client: client as unknown as FiberRpcClient,
      store,
      alerts,
      config: {
        intervalMs: 1000,
        completedItemTtlSeconds: 60,
      },
    });

    await (tracker as unknown as { poll: () => Promise<void> }).poll();

    expect(store.getTrackedPayment('0xpay-missing')?.status).toBe('Failed');
    expect(emitted.some((item) => item.type === 'outgoing_payment_failed')).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
