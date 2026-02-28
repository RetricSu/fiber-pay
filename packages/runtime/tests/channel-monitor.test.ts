import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Channel, ChannelState, type FiberRpcClient } from '@fiber-pay/sdk';
import { describe, expect, it } from 'vitest';
import { AlertManager } from '../src/alerts/alert-manager.js';
import type { Alert, AlertBackend } from '../src/alerts/types.js';
import { ChannelMonitor } from '../src/monitors/channel-monitor.js';
import { MemoryStore } from '../src/storage/memory-store.js';

class CaptureAlertBackend implements AlertBackend {
  constructor(private readonly alerts: Alert[]) {}

  async send(alert: Alert): Promise<void> {
    this.alerts.push(alert);
  }
}

function makeChannel(overrides: Partial<Channel>): Channel {
  return {
    channel_id: '0x01',
    is_public: false,
    is_acceptor: false,
    is_one_way: false,
    channel_outpoint: null,
    peer_id: 'peer-1',
    funding_udt_type_script: null,
    state: { state_name: ChannelState.AwaitingChannelReady },
    local_balance: '0x1',
    offered_tlc_balance: '0x0',
    remote_balance: '0x2',
    received_tlc_balance: '0x0',
    pending_tlcs: [],
    latest_commitment_transaction_hash: null,
    created_at: '0x0',
    enabled: true,
    tlc_expiry_delta: '0x1',
    tlc_fee_proportional_millionths: '0x1',
    shutdown_transaction_hash: null,
    ...overrides,
  };
}

describe('ChannelMonitor', () => {
  it('emits generic channel_state_changed alongside specific ready alert', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fiber-channel-monitor-'));
    const store = new MemoryStore({
      stateFilePath: join(dir, 'runtime-state.json'),
      flushIntervalMs: 1000,
      maxAlertHistory: 100,
    });

    const emitted: Alert[] = [];
    const alerts = new AlertManager({
      backends: [new CaptureAlertBackend(emitted)],
      store,
    });

    const snapshots: Channel[][] = [
      [makeChannel({ state: { state_name: ChannelState.AwaitingChannelReady } })],
      [makeChannel({ state: { state_name: ChannelState.ChannelReady } })],
    ];

    const client = {
      listChannels: async () => ({ channels: snapshots.shift() ?? [] }),
    };

    const monitor = new ChannelMonitor({
      client: client as unknown as FiberRpcClient,
      store,
      alerts,
      config: {
        intervalMs: 1000,
        includeClosedChannels: true,
      },
    });

    await (monitor as unknown as { poll: () => Promise<void> }).poll();
    await (monitor as unknown as { poll: () => Promise<void> }).poll();

    expect(emitted.some((item) => item.type === 'channel_state_changed')).toBe(true);
    expect(emitted.some((item) => item.type === 'channel_became_ready')).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });
});
