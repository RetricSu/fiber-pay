import type { FiberRpcClient } from '@fiber-pay/sdk';
import type { AlertManager } from '../alerts/alert-manager.js';
import { diffPeers } from '../diff/peer-diff.js';
import type { Store } from '../storage/types.js';
import { BaseMonitor, type BaseMonitorHooks } from './base-monitor.js';

export interface PeerMonitorConfig {
  intervalMs: number;
}

export class PeerMonitor extends BaseMonitor {
  protected get name(): string {
    return 'peer-monitor';
  }

  private readonly client: FiberRpcClient;
  private readonly store: Store;
  private readonly alerts: AlertManager;

  constructor(options: {
    client: FiberRpcClient;
    store: Store;
    alerts: AlertManager;
    config: PeerMonitorConfig;
    hooks?: BaseMonitorHooks;
  }) {
    super(options.config.intervalMs, options.hooks);
    this.client = options.client;
    this.store = options.store;
    this.alerts = options.alerts;
  }

  protected async poll(): Promise<void> {
    const previous = this.store.getPeerSnapshot();
    const result = await this.client.listPeers();
    const current = result.peers;

    const changes = diffPeers(previous, current);
    for (const change of changes) {
      if (change.type === 'peer_connected') {
        await this.alerts.emit({
          type: 'peer_connected',
          priority: 'low',
          source: this.name,
          data: { peer: change.peer },
        });
      }
      if (change.type === 'peer_disconnected') {
        await this.alerts.emit({
          type: 'peer_disconnected',
          priority: 'low',
          source: this.name,
          data: { peer: change.peer },
        });
      }
    }

    this.store.setPeerSnapshot(current);
  }
}
