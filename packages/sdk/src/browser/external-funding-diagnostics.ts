import type { IFiberClient } from '../types/fiber-client.js';
import type { HexString, Script } from '../types/rpc.js';
import { formatShannonsAsCkb, getLockBalanceShannons } from './ckb-balance.js';

const SHANNONS_PER_CKB = 100_000_000n;
const SUGGESTED_FEE_BUFFER_SHANNONS = 100_000n; // 0.001 CKB
// These patterns match Fiber v0.8.1 error strings. Keep them isolated for easier updates.
const FUNDING_ABORT_ERROR_PATTERN =
  /abortfunding|funding transaction aborted|stopped before unsigned external funding tx|channel .* stopped/i;
const REQUIRED_CAPACITY_ERROR_PATTERN = /value=([0-9]+(?:\.[0-9]+)?)/i;

function parseCkbToShannons(ckbAmount: string): bigint {
  const normalized = ckbAmount.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Funding amount must be a valid CKB number.');
  }

  const [wholePart, fracPart = ''] = normalized.split('.');
  if (fracPart.length > 8 && /[1-9]/.test(fracPart.slice(8))) {
    throw new Error('Funding amount supports up to 8 decimal places.');
  }

  const fracPadded = `${fracPart}00000000`.slice(0, 8);
  const shannons = BigInt(wholePart) * SHANNONS_PER_CKB + BigInt(fracPadded || '0');

  if (shannons <= 0n) {
    throw new Error('Funding amount must be greater than 0.');
  }

  return shannons;
}

function shannonsToCkbString(shannons: bigint): string {
  const whole = shannons / SHANNONS_PER_CKB;
  const fraction = shannons % SHANNONS_PER_CKB;
  if (fraction === 0n) {
    return whole.toString();
  }
  return `${whole.toString()}.${fraction.toString().padStart(8, '0').replace(/0+$/, '')}`;
}

function parseHexToBigInt(hex: string | undefined): bigint {
  if (!hex) {
    return 0n;
  }
  const normalized = hex.toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(normalized)) {
    return 0n;
  }
  try {
    return BigInt(normalized);
  } catch {
    return 0n;
  }
}

function extractHexHashCandidates(input: string): HexString[] {
  const matches = input.match(/0x[a-fA-F0-9]{64}/g) ?? [];
  return Array.from(new Set(matches.map((item) => item.toLowerCase() as HexString)));
}

export function shouldDiagnoseFundingAbortError(message: string): boolean {
  return FUNDING_ABORT_ERROR_PATTERN.test(message);
}

export function extractRequiredCapacityCkbFromFundingError(message: string): string | null {
  const match = message.match(REQUIRED_CAPACITY_ERROR_PATTERN);
  return match?.[1] ?? null;
}

function compareHexBigIntDesc(aHex: string | undefined, bHex: string | undefined): number {
  const a = parseHexToBigInt(aHex);
  const b = parseHexToBigInt(bHex);
  if (a === b) {
    return 0;
  }
  return a > b ? -1 : 1;
}

function normalizeStateFlagsForDisplay(stateFlags: unknown): string {
  if (Array.isArray(stateFlags)) {
    const normalized = stateFlags
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0)
      .join(' | ');
    return normalized;
  }

  if (typeof stateFlags === 'string') {
    return stateFlags.trim();
  }

  if (stateFlags == null) {
    return '';
  }

  return String(stateFlags).trim();
}

export function computeSuggestedFundingAmountCkb(
  currentCkb: string,
  requiredCapacityCkb: string,
): string | null {
  const currentShannons = parseCkbToShannons(currentCkb);
  const requiredShannons = parseCkbToShannons(requiredCapacityCkb);

  if (requiredShannons <= currentShannons) {
    return null;
  }

  const shortfall = requiredShannons - currentShannons;
  const suggestedShannons = currentShannons - shortfall - SUGGESTED_FEE_BUFFER_SHANNONS;
  if (suggestedShannons <= 0n) {
    return null;
  }

  return shannonsToCkbString(suggestedShannons);
}

export interface DiagnoseExternalFundingFailureOptions {
  node: Pick<IFiberClient, 'listChannels'>;
  rawError: string;
  targetPubkey?: HexString;
  channelIdHint?: HexString;
  fundingLockScript?: Script;
  requestedFundingShannons?: bigint;
  ckbRpcUrl?: string;
}

export interface DiagnoseExternalFundingFailureResult {
  channelDiagnostic: string | null;
  balanceDiagnostic: string | null;
  summary: string | null;
}

export async function diagnoseExternalFundingFailure(
  options: DiagnoseExternalFundingFailureOptions,
): Promise<DiagnoseExternalFundingFailureResult> {
  const {
    node,
    rawError,
    targetPubkey,
    channelIdHint,
    fundingLockScript,
    requestedFundingShannons,
    ckbRpcUrl,
  } = options;

  const listMergedChannels = async (queryBase?: { pubkey?: HexString }) => {
    const [pendingResult, fullResult] = await Promise.all([
      node.listChannels({ ...(queryBase ?? {}), only_pending: true }),
      node.listChannels({ ...(queryBase ?? {}), include_closed: true }),
    ]);
    return [...pendingResult.channels, ...fullResult.channels];
  };

  let mergedChannels = await listMergedChannels(
    targetPubkey ? { pubkey: targetPubkey } : undefined,
  );
  if (mergedChannels.length === 0 && targetPubkey) {
    mergedChannels = await listMergedChannels();
  }

  const channelById = new Map(
    mergedChannels.map((channel) => [channel.channel_id.toLowerCase(), channel]),
  );

  const channelIdCandidates = [
    ...(channelIdHint ? [channelIdHint] : []),
    ...extractHexHashCandidates(rawError),
  ];

  let targetChannel = channelIdCandidates
    .map((id) => channelById.get(id.toLowerCase()))
    .find((channel): channel is NonNullable<typeof channel> => Boolean(channel));

  if (!targetChannel) {
    const failedChannels = Array.from(channelById.values()).filter(
      (channel) => channel.failure_detail,
    );
    if (failedChannels.length > 0) {
      failedChannels.sort((a, b) => compareHexBigIntDesc(a.created_at, b.created_at));
      [targetChannel] = failedChannels;
    }
  }

  const channelDiagnostic = targetChannel
    ? (() => {
        const failureDetail =
          targetChannel.failure_detail ?? 'No failure_detail returned by list_channels.';
        const normalizedStateFlags = normalizeStateFlagsForDisplay(targetChannel.state.state_flags);
        const stateFlags = normalizedStateFlags ? ` (${normalizedStateFlags})` : '';
        return `channel=${targetChannel.channel_id}, state=${targetChannel.state.state_name}${stateFlags}, failure_detail=${failureDetail}`;
      })()
    : null;

  let balanceDiagnostic: string | null = null;
  if (fundingLockScript && requestedFundingShannons !== undefined && ckbRpcUrl) {
    try {
      const balanceShannons = await getLockBalanceShannons(ckbRpcUrl, fundingLockScript);
      const balanceCkb = formatShannonsAsCkb(balanceShannons);
      const requestedCkb = formatShannonsAsCkb(requestedFundingShannons);

      if (balanceShannons < requestedFundingShannons) {
        balanceDiagnostic = `funding lock balance ~${balanceCkb} CKB < requested ${requestedCkb} CKB`;
      } else {
        balanceDiagnostic = `funding lock balance ~${balanceCkb} CKB (requested ${requestedCkb} CKB)`;
      }
    } catch {
      // Ignore balance diagnostic failure; channel diagnostic is still actionable.
    }
  } else if (fundingLockScript && requestedFundingShannons !== undefined && !ckbRpcUrl) {
    balanceDiagnostic = 'balance diagnostic skipped: ckbRpcUrl not provided';
  }

  const summary = [channelDiagnostic, balanceDiagnostic].filter(Boolean).join(' | ') || null;
  return {
    channelDiagnostic,
    balanceDiagnostic,
    summary,
  };
}
