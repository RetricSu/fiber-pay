import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Channel, PaymentHash, PeerInfo } from '@fiber-pay/sdk';
import {
  type Alert,
  type AlertFilter,
  alertPriorityOrder,
  type TrackedInvoiceState,
  type TrackedPaymentState,
} from '../alerts/types.js';
import type { PersistedRuntimeState, Store } from './types.js';

export interface MemoryStoreConfig {
  stateFilePath: string;
  flushIntervalMs: number;
  maxAlertHistory: number;
}

function nowMs(): number {
  return Date.now();
}

function toRecord<T extends { paymentHash: PaymentHash }>(
  items: Map<PaymentHash, T>,
): Record<PaymentHash, T> {
  return Object.fromEntries(items.entries()) as Record<PaymentHash, T>;
}

export class MemoryStore implements Store {
  private readonly config: MemoryStoreConfig;
  private channelSnapshot: Channel[] = [];
  private peerSnapshot: PeerInfo[] = [];
  private trackedInvoices = new Map<PaymentHash, TrackedInvoiceState>();
  private trackedPayments = new Map<PaymentHash, TrackedPaymentState>();
  private alerts: Alert[] = [];
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(config: MemoryStoreConfig) {
    this.config = config;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.config.stateFilePath, 'utf-8');
      const state = JSON.parse(raw) as PersistedRuntimeState;
      this.channelSnapshot = state.channels ?? [];
      this.peerSnapshot = state.peers ?? [];
      this.trackedInvoices = new Map(Object.entries(state.trackedInvoices ?? {})) as Map<
        PaymentHash,
        TrackedInvoiceState
      >;
      this.trackedPayments = new Map(Object.entries(state.trackedPayments ?? {})) as Map<
        PaymentHash,
        TrackedPaymentState
      >;
      this.alerts = state.alerts ?? [];
    } catch {
      this.channelSnapshot = [];
      this.peerSnapshot = [];
      this.trackedInvoices.clear();
      this.trackedPayments.clear();
      this.alerts = [];
    }
  }

  async flush(): Promise<void> {
    const state: PersistedRuntimeState = {
      channels: this.channelSnapshot,
      peers: this.peerSnapshot,
      trackedInvoices: toRecord(this.trackedInvoices),
      trackedPayments: toRecord(this.trackedPayments),
      alerts: this.alerts,
    };
    await mkdir(dirname(this.config.stateFilePath), { recursive: true });
    await writeFile(this.config.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  startAutoFlush(): void {
    this.stopAutoFlush();
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.config.flushIntervalMs);
  }

  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  pruneCompleted(ttlMs: number): void {
    const now = nowMs();
    for (const [hash, entry] of this.trackedInvoices.entries()) {
      if (entry.completedAt && now - entry.completedAt >= ttlMs) {
        this.trackedInvoices.delete(hash);
      }
    }
    for (const [hash, entry] of this.trackedPayments.entries()) {
      if (entry.completedAt && now - entry.completedAt >= ttlMs) {
        this.trackedPayments.delete(hash);
      }
    }
  }

  getChannelSnapshot(): Channel[] {
    return this.channelSnapshot;
  }

  setChannelSnapshot(channels: Channel[]): void {
    this.channelSnapshot = channels;
  }

  getPeerSnapshot(): PeerInfo[] {
    return this.peerSnapshot;
  }

  setPeerSnapshot(peers: PeerInfo[]): void {
    this.peerSnapshot = peers;
  }

  addTrackedInvoice(hash: PaymentHash, status = 'Open'): void {
    const existing = this.trackedInvoices.get(hash);
    if (existing) return;
    const now = nowMs();
    this.trackedInvoices.set(hash, {
      paymentHash: hash,
      status,
      trackedAt: now,
      updatedAt: now,
    });
  }

  listTrackedInvoices(): TrackedInvoiceState[] {
    return [...this.trackedInvoices.values()];
  }

  getTrackedInvoice(hash: PaymentHash): TrackedInvoiceState | undefined {
    return this.trackedInvoices.get(hash);
  }

  updateTrackedInvoice(hash: PaymentHash, status: string): void {
    const now = nowMs();
    const existing = this.trackedInvoices.get(hash);
    const next: TrackedInvoiceState = existing
      ? {
          ...existing,
          status,
          updatedAt: now,
          completedAt: isTerminalInvoiceStatus(status) ? (existing.completedAt ?? now) : undefined,
        }
      : {
          paymentHash: hash,
          status,
          trackedAt: now,
          updatedAt: now,
          completedAt: isTerminalInvoiceStatus(status) ? now : undefined,
        };
    this.trackedInvoices.set(hash, next);
  }

  addTrackedPayment(hash: PaymentHash, status = 'Created'): void {
    const existing = this.trackedPayments.get(hash);
    if (existing) return;
    const now = nowMs();
    this.trackedPayments.set(hash, {
      paymentHash: hash,
      status,
      trackedAt: now,
      updatedAt: now,
    });
  }

  listTrackedPayments(): TrackedPaymentState[] {
    return [...this.trackedPayments.values()];
  }

  getTrackedPayment(hash: PaymentHash): TrackedPaymentState | undefined {
    return this.trackedPayments.get(hash);
  }

  updateTrackedPayment(hash: PaymentHash, status: string): void {
    const now = nowMs();
    const existing = this.trackedPayments.get(hash);
    const next: TrackedPaymentState = existing
      ? {
          ...existing,
          status,
          updatedAt: now,
          completedAt: isTerminalPaymentStatus(status) ? (existing.completedAt ?? now) : undefined,
        }
      : {
          paymentHash: hash,
          status,
          trackedAt: now,
          updatedAt: now,
          completedAt: isTerminalPaymentStatus(status) ? now : undefined,
        };
    this.trackedPayments.set(hash, next);
  }

  addAlert(alert: Alert): void {
    this.alerts.push(alert);
    if (this.alerts.length > this.config.maxAlertHistory) {
      this.alerts.splice(0, this.alerts.length - this.config.maxAlertHistory);
    }
  }

  listAlerts(filters?: AlertFilter): Alert[] {
    const minPriority = filters?.minPriority;
    const type = filters?.type;
    const source = filters?.source;
    const limit = filters?.limit;

    let alerts = this.alerts;

    if (minPriority) {
      const minRank = alertPriorityOrder[minPriority];
      alerts = alerts.filter((alert) => alertPriorityOrder[alert.priority] >= minRank);
    }

    if (type) {
      alerts = alerts.filter((alert) => alert.type === type);
    }

    if (source) {
      alerts = alerts.filter((alert) => alert.source === source);
    }

    if (!limit || limit <= 0) {
      return [...alerts];
    }

    return alerts.slice(-limit);
  }
}

function isTerminalInvoiceStatus(status: string): boolean {
  return status === 'Paid' || status === 'Cancelled' || status === 'Expired';
}

function isTerminalPaymentStatus(status: string): boolean {
  return status === 'Success' || status === 'Failed';
}
