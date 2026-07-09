import {
  type CellDep,
  computeSuggestedFundingAmountCkb,
  DEFAULT_CKB_ASSET,
  diagnoseExternalFundingFailure,
  extractRequiredCapacityCkbFromFundingError,
  type HexString,
  type IFiberClient,
  type OpenChannelParams,
  type OpenChannelWithExternalFundingFlowResult,
  openChannelWithExternalFundingFlow,
  parseFundingAmount,
  type Script,
  shouldDiagnoseFundingAbortError,
  type UdtAsset,
  validateUdtTypeScript,
} from '@fiber-pay/sdk/browser';
import { useCallback, useMemo, useState } from 'react';

function toHexPrefixed(value: string): HexString {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Hex value is empty.');
  }
  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as HexString;
}

export interface ChannelOpenFlowParams {
  pubkey: string;
  fundingAmount?: string;
  /** @deprecated Use `fundingAmount` instead. */
  fundingAmountCkb?: string;
  externalWallet: boolean;
  shutdownScript?: Script;
  fundingLockScript?: Script;
  fundingLockScriptCellDeps?: CellDep[];
  signFundingTx?: (txForSigner: unknown) => Promise<unknown>;
  ckbRpcUrl?: string;
  asset?: UdtAsset;
}

export interface ChannelOpenFlowResult {
  mode: 'internal' | 'external';
  channelId: HexString;
  fundingTxHash?: HexString;
  unsignedFundingTx?: unknown;
  signedFundingTx?: Record<string, unknown>;
}

export interface UseChannelOpenFlowOptions {
  node: IFiberClient | null;
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

      let requestedFundingAmount: bigint | undefined;
      let effectiveFundingLockScript: Script | undefined = params.fundingLockScript;
      const asset = params.asset ?? DEFAULT_CKB_ASSET;
      if (asset.kind === 'udt') {
        validateUdtTypeScript(asset.script);
      }
      const fundingAmountInput = params.fundingAmount?.trim() || params.fundingAmountCkb?.trim();

      try {
        if (!fundingAmountInput) {
          throw new Error('Funding amount is required.');
        }
        requestedFundingAmount = parseFundingAmount(fundingAmountInput, asset);
        const fundingAmountHex = `0x${requestedFundingAmount.toString(16)}` as HexString;
        const pubkey = toHexPrefixed(params.pubkey);

        if (!params.externalWallet) {
          const openChannelParams: OpenChannelParams = {
            pubkey,
            funding_amount: fundingAmountHex,
          };
          if (asset.kind === 'udt') {
            openChannelParams.funding_udt_type_script = asset.script;
          }
          const openResult = await node.openChannel(openChannelParams);
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
            funding_amount: fundingAmountHex,
            shutdown_script: shutdownScript,
            funding_lock_script: effectiveFundingLockScript,
            funding_lock_script_cell_deps: params.fundingLockScriptCellDeps,
            ...(asset.kind === 'udt' ? { funding_udt_type_script: asset.script } : {}),
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
        if (requiredCapacity && asset.kind === 'ckb') {
          try {
            const suggested = computeSuggestedFundingAmountCkb(
              fundingAmountInput ?? '',
              requiredCapacity,
            );
            if (suggested) {
              setSuggestedFundingAmountCkb(suggested);
              displayMessage = `Insufficient capacity: current amount ${fundingAmountInput} CKB may not cover fee. Suggested amount: ${suggested} CKB. Original error: ${message}`;
            }
          } catch {
            // Preserve original flow error when suggestion calculation fails.
          }
        }

        setError(displayMessage);

        if (params.externalWallet) {
          const hasKnownAbortPattern = shouldDiagnoseFundingAbortError(message);
          if (!hasKnownAbortPattern) {
            onLog?.(
              'External funding error did not match known abort patterns; running best-effort diagnostics.',
            );
          }

          const targetPubkey = (() => {
            try {
              return toHexPrefixed(params.pubkey);
            } catch {
              return undefined;
            }
          })();

          try {
            const diagnoseResult = await diagnoseExternalFundingFailure({
              node,
              rawError: message,
              targetPubkey,
              fundingLockScript: effectiveFundingLockScript,
              requestedFundingShannons:
                asset.kind === 'ckb' && requestedFundingAmount !== undefined
                  ? requestedFundingAmount
                  : undefined,
              ckbRpcUrl: params.ckbRpcUrl,
            });

            if (diagnoseResult.summary) {
              setDiagnostic(diagnoseResult.summary);
              onLog?.(`External funding diagnostic: ${diagnoseResult.summary}`);
            } else {
              const fallbackDiagnostic =
                'No additional channel diagnostics were available for this external funding error.';
              setDiagnostic(fallbackDiagnostic);
              onLog?.(fallbackDiagnostic);
            }
          } catch (diagnosticError) {
            const diagnosticMessage =
              diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError);
            const fallbackDiagnostic =
              'External funding diagnostics failed; no additional diagnostic details are available.';
            setDiagnostic(fallbackDiagnostic);
            onLog?.(`External funding diagnostics failed: ${diagnosticMessage}`);
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
