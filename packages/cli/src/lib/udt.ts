import { resolveUdtAsset, type UdtAsset, type UdtTypeScript } from '@fiber-pay/sdk';
import type { createReadyRpcClient } from './rpc.js';

export interface ResolvedCliAsset {
  asset: UdtAsset;
  udtTypeScript?: UdtTypeScript;
  label: string;
}

/**
 * Resolve a UDT asset from CLI options and normalize the result for commands.
 *
 * @param options - CLI option values.
 * @param options.rawScript - Raw JSON script string, if provided.
 * @param options.name - Configured UDT name, if provided.
 * @param options.scriptOptionName - Option name for error messages.
 * @param rpc - Ready RPC client (required when resolving by name).
 * @returns Resolved asset, optional UDT type script, and display label.
 */
export async function resolveAssetFromOptions(options: {
  rawScript?: string;
  name?: string;
  scriptOptionName?: string;
  rpc: Awaited<ReturnType<typeof createReadyRpcClient>>;
}): Promise<ResolvedCliAsset> {
  const asset = await resolveUdtAsset({
    rawScript: options.rawScript,
    name: options.name,
    scriptOptionName: options.scriptOptionName,
    rpc: options.rpc,
  });

  if (asset.kind === 'udt') {
    return {
      asset,
      udtTypeScript: asset.script,
      label: asset.name ?? 'UDT',
    };
  }

  return { asset, label: 'CKB' };
}
