import type { Channel, HexString } from '@fiber-pay/sdk/browser';
import { ChannelState, shannonsToCkb } from '@fiber-pay/sdk/browser';
import type { CSSProperties } from 'react';
import type { ChannelFilter } from './types.js';

export function shorten(value: string, head = 10, tail = 8): string {
  if (!value || value.length <= head + tail + 3) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function summarizeError(message: string, max = 72): string {
  const trimmed = message.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 3)}...`;
}

export function toHexPrefixed(value: string): HexString {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Hex value is empty.');
  }
  return (/^0x/i.test(trimmed) ? trimmed : `0x${trimmed}`) as HexString;
}

export function isPendingChannelState(state: ChannelState): boolean {
  return (
    state === ChannelState.NegotiatingFunding ||
    state === ChannelState.CollaboratingFundingTx ||
    state === ChannelState.SigningCommitment ||
    state === ChannelState.AwaitingTxSignatures ||
    state === ChannelState.AwaitingChannelReady
  );
}

export function formatChannelBalance(shannonsHex: HexString): string {
  const ckb = shannonsToCkb(shannonsHex);
  return Number.isFinite(ckb) ? ckb.toFixed(4) : '0.0000';
}

export function isClosedChannelState(state: ChannelState): boolean {
  return state === ChannelState.Closed || state === ChannelState.ShuttingDown;
}

export function getChannelFilterState(channel: Channel): ChannelFilter {
  const state = channel.state.state_name;
  if (isPendingChannelState(state)) return 'pending';
  if (isClosedChannelState(state)) return 'closed';
  return 'active';
}

export function withDisabledStyle(style: CSSProperties, disabled: boolean): CSSProperties {
  if (!disabled) {
    return style;
  }
  return {
    ...style,
    opacity: 0.55,
    cursor: 'not-allowed',
  };
}
