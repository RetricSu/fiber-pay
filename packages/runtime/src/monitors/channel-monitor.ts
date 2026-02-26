import { ChannelState, type FiberRpcClient } from '@fiber-pay/sdk';
import type { AlertManager } from '../alerts/alert-manager.js';
import type { AlertPriority } from '../alerts/types.js';
import { diffChannels } from '../diff/channel-diff.js';
import type { Store } from '../storage/types.js';
import { BaseMonitor, type BaseMonitorHooks } from './base-monitor.js';

export interface ChannelMonitorConfig {
  intervalMs: number;
  includeClosedChannels: boolean;
}

export class ChannelMonitor extends BaseMonitor {
  protected get name(): string {
    return 'channel-monitor';
  }

  private readonly client: FiberRpcClient;
  private readonly store: Store;
  private readonly alerts: AlertManager;
  private readonly config: ChannelMonitorConfig;

  constructor(options: {
    client: FiberRpcClient;
    store: Store;
    alerts: AlertManager;
    config: ChannelMonitorConfig;
    hooks?: BaseMonitorHooks;
  }) {
    super(options.config.intervalMs, options.hooks);
    this.client = options.client;
    this.store = options.store;
    this.alerts = options.alerts;
    this.config = options.config;
  }

  protected async poll(): Promise<void> {
    const previous = this.store.getChannelSnapshot();
    const result = await this.client.listChannels({
      include_closed: this.config.includeClosedChannels,
    });
    const current = result.channels;
    const changes = diffChannels(previous, current);

    for (const change of changes) {
      if (
        change.type === 'channel_new' &&
        change.channel.state.state_name === ChannelState.NegotiatingFunding
      ) {
        await this.alerts.emit({
          type: 'new_inbound_channel_request',
          priority: 'high',
          source: this.name,
          data: { channelId: change.channel.channel_id, channel: change.channel },
        });
      }

      if (change.type === 'channel_state_changed') {
        await this.alerts.emit({
          type: 'channel_state_changed',
          priority: getChannelStatePriority(change.currentState),
          source: this.name,
          data: {
            channelId: change.channel.channel_id,
            previousState: change.previousState,
            currentState: change.currentState,
            channel: change.channel,
          },
        });
      }

      if (
        change.type === 'channel_state_changed' &&
        change.currentState === ChannelState.ChannelReady
      ) {
        await this.alerts.emit({
          type: 'channel_became_ready',
          priority: 'medium',
          source: this.name,
          data: change,
        });
      }

      if (
        change.type === 'channel_state_changed' &&
        (change.currentState === ChannelState.ShuttingDown ||
          change.currentState === ChannelState.Closed)
      ) {
        await this.alerts.emit({
          type: 'channel_closing',
          priority: 'high',
          source: this.name,
          data: change,
        });
      }

      if (change.type === 'channel_disappeared') {
        await this.alerts.emit({
          type: 'channel_state_changed',
          priority: 'high',
          source: this.name,
          data: {
            channelId: change.channelId,
            previousState: change.previousChannel.state.state_name,
            currentState: 'DISAPPEARED',
            channel: change.previousChannel,
          },
        });
        await this.alerts.emit({
          type: 'channel_closing',
          priority: 'high',
          source: this.name,
          data: change,
        });
      }

      if (change.type === 'channel_balance_changed') {
        await this.alerts.emit({
          type: 'channel_balance_changed',
          priority: 'low',
          source: this.name,
          data: change,
        });
      }

      if (change.type === 'channel_pending_tlc_added') {
        await this.alerts.emit({
          type: 'new_pending_tlc',
          priority: 'medium',
          source: this.name,
          data: change,
        });
      }
    }

    this.store.setChannelSnapshot(current);
  }
}

function getChannelStatePriority(stateName: string): AlertPriority {
  const normalized = stateName.toUpperCase();
  const closedState = String(ChannelState.Closed).toUpperCase();
  const shuttingDownState = String(ChannelState.ShuttingDown).toUpperCase();
  const readyState = String(ChannelState.ChannelReady).toUpperCase();

  if (
    normalized === closedState ||
    normalized === 'CLOSED' ||
    normalized === shuttingDownState ||
    normalized === 'SHUTTING_DOWN'
  ) {
    return 'high';
  }

  if (normalized === readyState || normalized === 'CHANNEL_READY') {
    return 'medium';
  }

  return 'low';
}
