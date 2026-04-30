import { describe, expect, it } from 'vitest';

import { normalizeChannel, normalizeChannelStateName } from '../src/rpc/normalize-channel.js';
import { type Channel, ChannelState } from '../src/types/index.js';

describe('normalizeChannelStateName', () => {
  it('maps SCREAMING_SNAKE_CASE aliases to enum values', () => {
    expect(normalizeChannelStateName('CHANNEL_READY')).toBe(ChannelState.ChannelReady);
    expect(normalizeChannelStateName('NEGOTIATING_FUNDING')).toBe(ChannelState.NegotiatingFunding);
    expect(normalizeChannelStateName('AWAITING_TX_SIGNATURES')).toBe(
      ChannelState.AwaitingTxSignatures,
    );
    expect(normalizeChannelStateName('CLOSED')).toBe(ChannelState.Closed);
  });

  it('passes through canonical PascalCase values', () => {
    expect(normalizeChannelStateName('ChannelReady')).toBe(ChannelState.ChannelReady);
    expect(normalizeChannelStateName('NegotiatingFunding')).toBe(ChannelState.NegotiatingFunding);
  });

  it('normalizes mixed punctuation/casing variants', () => {
    expect(normalizeChannelStateName('channel-ready')).toBe(ChannelState.ChannelReady);
    expect(normalizeChannelStateName('channel_ready')).toBe(ChannelState.ChannelReady);
  });

  it('falls back to the input for unknown states', () => {
    expect(normalizeChannelStateName('SomeUnknownState')).toBe('SomeUnknownState');
  });
});

describe('normalizeChannel', () => {
  it('normalizes state.state_name and preserves other fields', () => {
    const channel = {
      channel_id: '0xabc',
      state: {
        state_name: 'CHANNEL_READY',
        state_flags: [],
      },
      foo: 'bar',
    } as unknown as Channel;

    const result = normalizeChannel(channel);
    expect(result.state.state_name).toBe(ChannelState.ChannelReady);
    expect(result.channel_id).toBe('0xabc');
    expect((result as unknown as { foo: string }).foo).toBe('bar');
    // does not mutate input
    expect(channel.state.state_name).toBe('CHANNEL_READY');
  });
});
