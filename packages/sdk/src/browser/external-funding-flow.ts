import type { IFiberClient } from '../types/fiber-client.js';
import type {
  Hash256,
  OpenChannelWithExternalFundingParams,
  OpenChannelWithExternalFundingResult,
} from '../types/rpc.js';
import {
  normalizeCkbTransactionForCcc,
  normalizeCkbTransactionForRpc,
} from './ckb-transaction-normalizer.js';

export interface OpenChannelWithExternalFundingFlowResult {
  channelId: OpenChannelWithExternalFundingResult['channel_id'];
  unsignedFundingTx: OpenChannelWithExternalFundingResult['unsigned_funding_tx'];
  signedFundingTx: Record<string, unknown>;
  fundingTxHash: Hash256;
}

export interface OpenChannelWithExternalFundingFlowOptions {
  node: Pick<IFiberClient, 'openChannelWithExternalFunding' | 'submitSignedFundingTx'>;
  params: OpenChannelWithExternalFundingParams;
  signFundingTx: (txForSigner: unknown) => Promise<unknown>;
}

/**
 * High-level external funding flow helper.
 *
 * It performs open -> sign -> submit in one call and normalizes tx formats
 * between Fiber RPC (snake_case) and wallet SDKs (camelCase) automatically.
 */
export async function openChannelWithExternalFundingFlow(
  options: OpenChannelWithExternalFundingFlowOptions,
): Promise<OpenChannelWithExternalFundingFlowResult> {
  const { node, params, signFundingTx } = options;

  const openResult = await node.openChannelWithExternalFunding(params);
  const txForSigner = normalizeCkbTransactionForCcc(openResult.unsigned_funding_tx);
  const signedFundingTxRaw = await signFundingTx(txForSigner);
  const signedFundingTx = normalizeCkbTransactionForRpc(signedFundingTxRaw) as Record<
    string,
    unknown
  >;

  const submitResult = await node.submitSignedFundingTx({
    channel_id: openResult.channel_id,
    signed_funding_tx: signedFundingTx,
  });

  return {
    channelId: openResult.channel_id,
    unsignedFundingTx: openResult.unsigned_funding_tx,
    signedFundingTx,
    fundingTxHash: submitResult.funding_tx_hash,
  };
}
