import { shannonsToCkb, toHex } from '../utils.js';
import type { Channel } from '../types/rpc.js';

export interface FormattedChannelBalances {
  local: string;
  remote: string;
  capacity: string;
  unit: 'CKB' | 'UDT';
  fundingUdtTypeScript: Record<string, unknown> | undefined;
}

/**
 * Format channel balances for display, choosing raw UDT units or CKB conversion.
 *
 * @param channel - Channel data from `list_channels`.
 * @returns Display-ready balance fields and unit label.
 */
export function formatChannelBalances(channel: Channel): FormattedChannelBalances {
  const local = BigInt(channel.local_balance);
  const remote = BigInt(channel.remote_balance);
  const capacity = local + remote;
  const isUdt = channel.funding_udt_type_script !== null;
  const unit = isUdt ? 'UDT' : 'CKB';

  return {
    local: isUdt ? local.toString() : shannonsToCkb(channel.local_balance),
    remote: isUdt ? remote.toString() : shannonsToCkb(channel.remote_balance),
    capacity: isUdt ? capacity.toString() : shannonsToCkb(toHex(capacity)),
    unit,
    fundingUdtTypeScript: channel.funding_udt_type_script ?? undefined,
  };
}
