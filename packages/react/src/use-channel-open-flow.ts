import {
  type CellDep,
  computeSuggestedFundingAmountCkb,
  diagnoseExternalFundingFailure,
  extractRequiredCapacityCkbFromFundingError,
  type FiberBrowserNode,
  type HexString,
  type OpenChannelWithExternalFundingFlowResult,
  openChannelWithExternalFundingFlow,
  type Script,
  shouldDiagnoseFundingAbortError,
} from '@fiber-pay/sdk/browser';
import { useCallback, useMemo, useState } from 'react';

const SHANNONS_PER_CKB = 100_000_000n;

function toHexPrefixed(value: string): HexString {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Hex value is empty.');
  }
  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as HexString;
}

function ckbToShannons(amountCkb: string): bigint {
  const normalized = amountCkb.trim();
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

export interface ChannelOpenFlowParams {
  pubkey: string;
  fundingAmountCkb: string;
  externalWallet: boolean;
  shutdownScript?: Script;
  fundingLockScript?: Script;
  fundingLockScriptCellDeps?: CellDep[];
  signFundingTx?: (txForSigner: unknown) => Promise<unknown>;
  ckbRpcUrl?: string;
}

export interface ChannelOpenFlowResult {
  mode: 'internal' | 'external';
  channelId: HexString;
  fundingTxHash?: HexString;
  unsignedFundingTx?: unknown;
  signedFundingTx?: Record<string, unknown>;
}

export interface UseChannelOpenFlowOptions {
  node: FiberBrowserNode | null;
  onLog?: (message: string) => void;
}

export interface UseChannelOpenFlowResult {
  openChannel: (params: ChannelOpenFlowParams) => Promise<ChannelOpenFlowResult | null>;
  reset: () => void;
  isOpening: boolean;
  error: string | null;
  diagnostic: string | null;
  suggestedFundingAmountCkb: string | null;
  lastResult: ChannelOpenFlowResult | null;
}

function toHookResultFromExternal(
  result: OpenChannelWithExternalFundingFlowResult,
): ChannelOpenFlowResult {
  return {
    mode: 'external',
    channelId: result.channelId,
    fundingTxHash: result.fundingTxHash,
    unsignedFundingTx: result.unsignedFundingTx,
    signedFundingTx: result.signedFundingTx,
  };
}

export function useChannelOpenFlow(options: UseChannelOpenFlowOptions): UseChannelOpenFlowResult {
  const { node, onLog } = options;
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [suggestedFundingAmountCkb, setSuggestedFundingAmountCkb] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ChannelOpenFlowResult | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setDiagnostic(null);
    setSuggestedFundingAmountCkb(null);
    setLastResult(null);
  }, []);

  const openChannel = useCallback(
    async (params: ChannelOpenFlowParams): Promise<ChannelOpenFlowResult | null> => {
      if (!node) {
        setError('Node is not connected.');
        return null;
      }

      setIsOpening(true);
      setError(null);
      setDiagnostic(null);
      setSuggestedFundingAmountCkb(null);

      let requestedFundingShannons: bigint | undefined;
      let effectiveFundingLockScript: Script | undefined = params.fundingLockScript;

      try {
        requestedFundingShannons = ckbToShannons(params.fundingAmountCkb);
        const pubkey = toHexPrefixed(params.pubkey);

        if (!params.externalWallet) {
          const openResult = await node.openChannel({
            pubkey,
            funding_amount: `0x${requestedFundingShannons.toString(16)}` as HexString,
          });
          const result: ChannelOpenFlowResult = {
            mode: 'internal',
            channelId: openResult.temporary_channel_id,
          };
          setLastResult(result);
          onLog?.(`Internal channel open requested: ${openResult.temporary_channel_id}`);
          return result;
        }

        if (!params.signFundingTx) {
          throw new Error('Missing signFundingTx callback for external wallet funding flow.');
        }

        const nodeInfo = await node.nodeInfo();
        const defaultScript = nodeInfo.default_funding_lock_script;
        const shutdownScript = params.shutdownScript ?? defaultScript;
        effectiveFundingLockScript = params.fundingLockScript ?? defaultScript;

        const flowResult = await openChannelWithExternalFundingFlow({
          node,
          params: {
            pubkey,
            funding_amount: `0x${requestedFundingShannons.toString(16)}` as HexString,
            shutdown_script: shutdownScript,
            funding_lock_script: effectiveFundingLockScript,
            funding_lock_script_cell_deps: params.fundingLockScriptCellDeps,
          },
          signFundingTx: params.signFundingTx,
        });

        const result = toHookResultFromExternal(flowResult);
        setLastResult(result);
        onLog?.(
          `External funding completed: channel=${flowResult.channelId}, tx=${flowResult.fundingTxHash}`,
        );
        return result;
      } catch (unknownError) {
        const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
        let displayMessage = message;

        const requiredCapacity = extractRequiredCapacityCkbFromFundingError(message);
        if (requiredCapacity) {
          const suggested = computeSuggestedFundingAmountCkb(
            params.fundingAmountCkb,
            requiredCapacity,
          );
          if (suggested) {
            setSuggestedFundingAmountCkb(suggested);
            displayMessage = `容量不足：当前金额 ${params.fundingAmountCkb} CKB 不能覆盖手续费。建议改为 ${suggested} CKB。原始错误：${message}`;
          }
        }

        setError(displayMessage);

        if (params.externalWallet && shouldDiagnoseFundingAbortError(message)) {
          const diagnoseResult = await diagnoseExternalFundingFailure({
            node,
            rawError: message,
            targetPubkey: toHexPrefixed(params.pubkey),
            fundingLockScript: effectiveFundingLockScript,
            requestedFundingShannons,
            ckbRpcUrl: params.ckbRpcUrl,
          });
          if (diagnoseResult.summary) {
            setDiagnostic(diagnoseResult.summary);
            onLog?.(`External funding diagnostic: ${diagnoseResult.summary}`);
          }
        }

        onLog?.(`Channel open flow failed: ${message}`);
        return null;
      } finally {
        setIsOpening(false);
      }
    },
    [node, onLog],
  );

  return useMemo(
    () => ({
      openChannel,
      reset,
      isOpening,
      error,
      diagnostic,
      suggestedFundingAmountCkb,
      lastResult,
    }),
    [openChannel, reset, isOpening, error, diagnostic, suggestedFundingAmountCkb, lastResult],
  );
}
