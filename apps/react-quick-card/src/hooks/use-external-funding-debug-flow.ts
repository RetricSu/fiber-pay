import { ccc } from '@ckb-ccc/connector-react';
import {
  diagnoseExternalFundingFailure,
  normalizeCkbTransactionForCcc,
  normalizeCkbTransactionForRpc,
  shouldDiagnoseFundingAbortError,
  type HexString,
  type IFiberClient,
} from '@fiber-pay/sdk/browser';
import { useState } from 'react';

function toHexPrefixed(value: string): HexString {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Hex value is empty.');
  }

  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as HexString;
}

export interface ExternalFundingSessionLike {
  channelId: HexString;
  unsignedFundingTx: unknown;
}

export interface UseExternalFundingDebugFlowOptions {
  node: IFiberClient | null;
  cccSigner: ccc.Signer | null | undefined;
  resolveExternalSigner: () => ((tx: unknown) => Promise<unknown>) | null;
  externalFundingSession: ExternalFundingSessionLike | null;
  externalFundingPeerPubkey: string;
  unsignedFundingTxJson: string;
  signedFundingTxJson: string;
  setSignedFundingTxJson: (value: string) => void;
  setExternalFundingError: (value: string | null) => void;
  setExternalFundingDiagnostic: (value: string | null) => void;
  setFundingSubmitTxHash: (value: string | null) => void;
  addLog: (message: string) => void;
}

export interface UseExternalFundingDebugFlowResult {
  isSigningExternalFunding: boolean;
  isSubmittingExternalFunding: boolean;
  copyUnsignedFundingTx: () => Promise<void>;
  signWithExternalWallet: () => Promise<void>;
  submitSignedFunding: () => Promise<void>;
}

export function useExternalFundingDebugFlow(
  options: UseExternalFundingDebugFlowOptions,
): UseExternalFundingDebugFlowResult {
  const {
    node,
    cccSigner,
    resolveExternalSigner,
    externalFundingSession,
    externalFundingPeerPubkey,
    unsignedFundingTxJson,
    signedFundingTxJson,
    setSignedFundingTxJson,
    setExternalFundingError,
    setExternalFundingDiagnostic,
    setFundingSubmitTxHash,
    addLog,
  } = options;

  const [isSigningExternalFunding, setIsSigningExternalFunding] = useState(false);
  const [isSubmittingExternalFunding, setIsSubmittingExternalFunding] = useState(false);

  const copyUnsignedFundingTx = async () => {
    if (!unsignedFundingTxJson.trim()) {
      setExternalFundingError('No unsigned funding tx to copy.');
      return;
    }

    try {
      await navigator.clipboard.writeText(unsignedFundingTxJson);
      setExternalFundingError(null);
      addLog('Unsigned funding tx copied to clipboard.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExternalFundingError(message);
      addLog(`Copy unsigned tx failed: ${message}`);
    }
  };

  const signWithExternalWallet = async () => {
    if (!unsignedFundingTxJson.trim()) {
      setExternalFundingError('No unsigned funding tx found. Start funding request first.');
      return;
    }

    setIsSigningExternalFunding(true);
    setExternalFundingError(null);

    try {
      const unsignedTx = JSON.parse(unsignedFundingTxJson) as unknown;
      let signedTx: unknown;

      if (cccSigner) {
        try {
          const txForCcc = normalizeCkbTransactionForCcc(unsignedTx);
          const cccSignedTx = await cccSigner.signTransaction(txForCcc as ccc.TransactionLike);
          const cccSignedPlain = JSON.parse(JSON.stringify(cccSignedTx)) as unknown;
          signedTx = normalizeCkbTransactionForRpc(cccSignedPlain);
          addLog('External wallet signing completed via CCC signer. Ready to submit signed funding tx.');
        } catch (cccSignError) {
          const cccSignMessage =
            cccSignError instanceof Error ? cccSignError.message : String(cccSignError);
          addLog(`CCC signer failed, fallback to window signer: ${cccSignMessage}`);
        }
      }

      if (!signedTx) {
        const sign = resolveExternalSigner();
        if (!sign) {
          throw new Error(
            'No external wallet signer found. Connect wallet via CCC first, or expose window.ckbExternalWallet.signTransaction(tx).',
          );
        }

        signedTx = await sign(unsignedTx);
      }

      const normalizedSignedTx = normalizeCkbTransactionForRpc(signedTx);
      setSignedFundingTxJson(JSON.stringify(normalizedSignedTx, null, 2));
      addLog('Signed funding tx is prepared. Ready to submit signed funding tx.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExternalFundingError(message);
      addLog(`External wallet signing failed: ${message}`);
    } finally {
      setIsSigningExternalFunding(false);
    }
  };

  const submitSignedFunding = async () => {
    if (!node) {
      setExternalFundingError('Node is not connected.');
      return;
    }

    if (!externalFundingSession) {
      setExternalFundingError('No pending channel funding session. Start funding request first.');
      return;
    }

    if (!signedFundingTxJson.trim()) {
      setExternalFundingError('Signed funding tx is empty.');
      return;
    }

    setIsSubmittingExternalFunding(true);
    setExternalFundingError(null);
    setExternalFundingDiagnostic(null);

    try {
      const signedTx = JSON.parse(signedFundingTxJson) as unknown;
      const normalizedSignedTx = normalizeCkbTransactionForRpc(signedTx) as Record<string, unknown>;
      const result = await node.submitSignedFundingTx({
        channel_id: externalFundingSession.channelId,
        signed_funding_tx: normalizedSignedTx,
      });

      setFundingSubmitTxHash(result.funding_tx_hash);
      addLog(`Submitted signed funding tx: ${result.funding_tx_hash}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExternalFundingError(message);

      if (shouldDiagnoseFundingAbortError(message)) {
        const targetPubkey = (() => {
          try {
            return toHexPrefixed(externalFundingPeerPubkey);
          } catch {
            return undefined;
          }
        })();

        try {
          const diagnostic = await diagnoseExternalFundingFailure({
            node,
            rawError: message,
            targetPubkey,
            channelIdHint: externalFundingSession.channelId,
          });

          if (diagnostic.summary) {
            setExternalFundingDiagnostic(diagnostic.summary);
            addLog(`Submit funding diagnostic: ${diagnostic.summary}`);
          }
        } catch (diagnosticError) {
          const diagnosticMessage =
            diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError);
          addLog(`Submit funding diagnostic lookup failed: ${diagnosticMessage}`);
        }
      }

      addLog(`Submit signed funding tx failed: ${message}`);
    } finally {
      setIsSubmittingExternalFunding(false);
    }
  };

  return {
    isSigningExternalFunding,
    isSubmittingExternalFunding,
    copyUnsignedFundingTx,
    signWithExternalWallet,
    submitSignedFunding,
  };
}
