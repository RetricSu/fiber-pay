import type { Channel, Htlc } from '@fiber-pay/sdk';

export type ChannelDiffEvent =
  | { type: 'channel_new'; channel: Channel }
  | { type: 'channel_state_changed'; channel: Channel; previousState: string; currentState: string }
  | {
      type: 'channel_balance_changed';
      channel: Channel;
      localBalanceBefore: string;
      localBalanceAfter: string;
      remoteBalanceBefore: string;
      remoteBalanceAfter: string;
    }
  | {
      type: 'channel_pending_tlc_added';
      channel: Channel;
      previousPendingTlcCount: number;
      newPendingTlcCount: number;
    }
  | { type: 'channel_disappeared'; channelId: string; previousChannel: Channel };

export function diffChannels(previous: Channel[], current: Channel[]): ChannelDiffEvent[] {
  const events: ChannelDiffEvent[] = [];
  const prevById = new Map(previous.map((channel) => [channel.channel_id, channel]));
  const currById = new Map(current.map((channel) => [channel.channel_id, channel]));

  for (const [channelId, channel] of currById.entries()) {
    const previousChannel = prevById.get(channelId);
    if (!previousChannel) {
      events.push({ type: 'channel_new', channel });
      continue;
    }

    if (channel.state.state_name !== previousChannel.state.state_name) {
      events.push({
        type: 'channel_state_changed',
        channel,
        previousState: previousChannel.state.state_name,
        currentState: channel.state.state_name,
      });
    }

    if (
      channel.local_balance !== previousChannel.local_balance ||
      channel.remote_balance !== previousChannel.remote_balance
    ) {
      events.push({
        type: 'channel_balance_changed',
        channel,
        localBalanceBefore: previousChannel.local_balance,
        localBalanceAfter: channel.local_balance,
        remoteBalanceBefore: previousChannel.remote_balance,
        remoteBalanceAfter: channel.remote_balance,
      });
    }

    const previousPending = new Set(previousChannel.pending_tlcs.map((tlc: Htlc) => tlc.id));
    const newTlcCount = channel.pending_tlcs.filter(
      (tlc: Htlc) => !previousPending.has(tlc.id),
    ).length;
    if (newTlcCount > 0) {
      events.push({
        type: 'channel_pending_tlc_added',
        channel,
        previousPendingTlcCount: previousChannel.pending_tlcs.length,
        newPendingTlcCount: channel.pending_tlcs.length,
      });
    }
  }

  for (const [channelId, previousChannel] of prevById.entries()) {
    if (!currById.has(channelId)) {
      events.push({
        type: 'channel_disappeared',
        channelId,
        previousChannel,
      });
    }
  }

  return events;
}
