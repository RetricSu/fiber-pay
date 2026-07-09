import type { Channel, Script } from '../types/rpc.js';
import { shannonsToCkb, toHex } from '../utils.js';
import type { UdtAsset } from './types.js';

export const DEFAULT_CKB_ASSET: UdtAsset = { kind: 'ckb' };

export type FormattedChannelBalances =
  | {
      kind: 'ckb';
      local: number;
      remote: number;
      capacity: number;
      fundingUdtTypeScript: undefined;
    }
  | {
      kind: 'udt';
      local: string;
      remote: string;
      capacity: string;
      fundingUdtTypeScript: Script;
    };

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

  if (channel.funding_udt_type_script != null) {
    return {
      kind: 'udt',
      local: local.toString(),
      remote: remote.toString(),
      capacity: capacity.toString(),
      fundingUdtTypeScript: channel.funding_udt_type_script,
    };
  }

  return {
    kind: 'ckb',
    local: shannonsToCkb(channel.local_balance),
    remote: shannonsToCkb(channel.remote_balance),
    capacity: shannonsToCkb(toHex(capacity)),
    fundingUdtTypeScript: undefined,
  };
}

/**
 * Return a human-readable unit name for an asset.
 *
 * @param asset - Asset descriptor (CKB or UDT).
 * @returns 'CKB' for CKB assets, or the trimmed UDT name with 'UDT' fallback.
 */
export function formatAssetName(asset: UdtAsset): string {
  if (asset.kind === 'udt') {
    return asset.name?.trim() || 'UDT';
  }
  return 'CKB';
}
