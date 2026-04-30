/**
 * Channel normalization helpers.
 *
 * The Fiber node may return channel `state_name` in different casings depending
 * on the transport (JSON-RPC over HTTP vs WASM adapter). These helpers normalize
 * the value to the canonical SCREAMING_SNAKE_CASE `ChannelState` enum so that
 * consumers can rely on `=== ChannelState.X` comparisons regardless of which
 * client they use.
 */

import { type Channel, ChannelState } from '../types/index.js';

const CHANNEL_STATE_ALIASES: Record<string, ChannelState> = {
  NEGOTIATING_FUNDING: ChannelState.NegotiatingFunding,
  COLLABORATING_FUNDING_TX: ChannelState.CollaboratingFundingTx,
  SIGNING_COMMITMENT: ChannelState.SigningCommitment,
  AWAITING_TX_SIGNATURES: ChannelState.AwaitingTxSignatures,
  AWAITING_CHANNEL_READY: ChannelState.AwaitingChannelReady,
  CHANNEL_READY: ChannelState.ChannelReady,
  SHUTTING_DOWN: ChannelState.ShuttingDown,
  CLOSED: ChannelState.Closed,
};

/**
 * Normalize a channel state name to the canonical `ChannelState` enum value.
 *
 * Accepts SCREAMING_SNAKE_CASE (e.g. `"CHANNEL_READY"`), PascalCase
 * (e.g. `"ChannelReady"`), and other variants by stripping non-alphanumeric
 * characters and comparing case-insensitively.
 *
 * Falls back to returning the input unchanged (cast to `ChannelState`) if no
 * match is found, so unknown future states do not throw.
 */
export function normalizeChannelStateName(stateName: string): ChannelState {
  const alias = CHANNEL_STATE_ALIASES[stateName];
  if (alias) return alias;

  const normalizedInput = stateName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  for (const value of Object.values(ChannelState)) {
    const normalizedValue = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (normalizedValue === normalizedInput) {
      return value;
    }
  }

  return stateName as ChannelState;
}

/**
 * Return a copy of `channel` with its `state.state_name` normalized.
 */
export function normalizeChannel(channel: Channel): Channel {
  return {
    ...channel,
    state: {
      ...channel.state,
      state_name: normalizeChannelStateName(channel.state.state_name),
    },
  };
}
