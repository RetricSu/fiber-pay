import { type Channel, ChannelState } from '@fiber-pay/sdk';
import { describe, expect, it } from 'vitest';
import { diffChannels } from '../src/diff/channel-diff.js';

function makeChannel(overrides: Partial<Channel>): Channel {
  return {
    channel_id: '0x01',
    is_public: true,
    channel_outpoint: null,
    peer_id: 'peer-1',
    funding_udt_type_script: null,
    state: { state_name: ChannelState.NegotiatingFunding },
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

describe('diffChannels', () => {
  it('detects new channels and state changes', () => {
    const previous: Channel[] = [
      makeChannel({
        channel_id: '0xaaa',
        state: { state_name: ChannelState.AwaitingChannelReady },
      }),
    ];
    const current: Channel[] = [
      makeChannel({
        channel_id: '0xaaa',
        state: { state_name: ChannelState.ChannelReady },
      }),
      makeChannel({
        channel_id: '0xbbb',
        state: { state_name: ChannelState.NegotiatingFunding },
      }),
    ];

    const events = diffChannels(previous, current);

    expect(events.some((event) => event.type === 'channel_new')).toBe(true);
    expect(events.some((event) => event.type === 'channel_state_changed')).toBe(true);
  });

  it('detects balance and tlc changes', () => {
    const previous: Channel[] = [
      makeChannel({
        channel_id: '0xccc',
        local_balance: '0x1',
        remote_balance: '0x2',
        pending_tlcs: [],
      }),
    ];
    const current: Channel[] = [
      makeChannel({
        channel_id: '0xccc',
        local_balance: '0x3',
        remote_balance: '0x4',
        pending_tlcs: [
          {
            id: '0x1',
            amount: '0x1',
            payment_hash: '0x1',
            expiry: '0x1',
            status: { Inbound: {} },
          },
        ],
      }),
    ];

    const events = diffChannels(previous, current);

    expect(events.some((event) => event.type === 'channel_balance_changed')).toBe(true);
    expect(events.some((event) => event.type === 'channel_pending_tlc_added')).toBe(true);
  });
});
