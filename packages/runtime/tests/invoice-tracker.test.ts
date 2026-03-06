import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FiberRpcClient } from '@fiber-pay/sdk';
import { describe, expect, it } from 'vitest';
import { AlertManager } from '../src/alerts/alert-manager.js';
import type { Alert, AlertBackend } from '../src/alerts/types.js';
import { InvoiceTracker } from '../src/monitors/invoice-tracker.js';
import { MemoryStore } from '../src/storage/memory-store.js';

class CaptureAlertBackend implements AlertBackend {
  constructor(private readonly alerts: Alert[]) {}

  async send(alert: Alert): Promise<void> {
    this.alerts.push(alert);
  }
}

function makeInvoiceResult(status: 'Open' | 'Received' | 'Paid' | 'Expired' | 'Cancelled') {
  return {
    invoice_address: 'ckt1invoice',
    status,
    invoice: {
      currency: 'fibt',
      amount: '0x64',
      signature: '0x00',
      data: {
        timestamp: '0x1',
        payment_hash: '0xinv123',
        expiry_time: '0x3c',
        final_htlc_timeout: '0x9',
      },
      hrp: 'fibt',
      hash_algorithm: 'Sha256',
      attrs: [],
      is_expired: status === 'Expired',
      payee_pub_key: null,
      description: null,
      fallback_address: null,
      expiry: null,
    },
  };
}

describe('InvoiceTracker', () => {
  it('does not poll terminal tracked invoices', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fiber-invoice-tracker-'));
    const store = new MemoryStore({
      stateFilePath: join(dir, 'runtime-state.json'),
      flushIntervalMs: 1000,
      maxAlertHistory: 100,
    });
    store.addTrackedInvoice('0xinv-terminal', 'Paid');

    const emitted: Alert[] = [];
    const alerts = new AlertManager({
      backends: [new CaptureAlertBackend(emitted)],
      store,
    });

    let getInvoiceCalls = 0;
    const client = {
      getInvoice: async () => {
        getInvoiceCalls++;
        return makeInvoiceResult('Paid');
      },
    };

    const tracker = new InvoiceTracker({
      client: client as unknown as FiberRpcClient,
      store,
      alerts,
      config: {
        intervalMs: 1000,
        completedItemTtlSeconds: 60,
      },
    });

    await (tracker as unknown as { poll: () => Promise<void> }).poll();

    expect(getInvoiceCalls).toBe(0);
    expect(emitted).toHaveLength(0);
    await rm(dir, { recursive: true, force: true });
  });

  it('emits invoice_expired when tracked invoice becomes Expired', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fiber-invoice-tracker-'));
    const store = new MemoryStore({
      stateFilePath: join(dir, 'runtime-state.json'),
      flushIntervalMs: 1000,
      maxAlertHistory: 100,
    });
    store.addTrackedInvoice('0xinv123', 'Open');

    const emitted: Alert[] = [];
    const alerts = new AlertManager({
      backends: [new CaptureAlertBackend(emitted)],
      store,
    });

    const client = {
      getInvoice: async () => makeInvoiceResult('Expired'),
    };

    const tracker = new InvoiceTracker({
      client: client as unknown as FiberRpcClient,
      store,
      alerts,
      config: {
        intervalMs: 1000,
        completedItemTtlSeconds: 60,
      },
    });

    await (tracker as unknown as { poll: () => Promise<void> }).poll();

    expect(emitted.some((item) => item.type === 'invoice_expired')).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('emits invoice_cancelled when tracked invoice becomes Cancelled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fiber-invoice-tracker-'));
    const store = new MemoryStore({
      stateFilePath: join(dir, 'runtime-state.json'),
      flushIntervalMs: 1000,
      maxAlertHistory: 100,
    });
    store.addTrackedInvoice('0xinv123', 'Open');

    const emitted: Alert[] = [];
    const alerts = new AlertManager({
      backends: [new CaptureAlertBackend(emitted)],
      store,
    });

    const client = {
      getInvoice: async () => makeInvoiceResult('Cancelled'),
    };

    const tracker = new InvoiceTracker({
      client: client as unknown as FiberRpcClient,
      store,
      alerts,
      config: {
        intervalMs: 1000,
        completedItemTtlSeconds: 60,
      },
    });

    await (tracker as unknown as { poll: () => Promise<void> }).poll();

    expect(emitted.some((item) => item.type === 'invoice_cancelled')).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
