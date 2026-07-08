import type { UdtCfgInfos } from '../types/rpc.js';
import { parseUdtTypeScript } from './parse.js';
import type { UdtAsset, UdtTypeScript } from './types.js';

export interface ResolveUdtAssetOptions {
  rawScript?: string;
  name?: string;
  scriptOptionName?: string;
  rpc: { nodeInfo(): Promise<{ udt_cfg_infos: UdtCfgInfos }> };
}

/**
 * Resolve a UDT asset from a raw script string, a configured name, or default to CKB.
 *
 * @param options - Resolution options.
 * @returns A `UdtAsset` describing CKB or a resolved UDT.
 */
export async function resolveUdtAsset(options: ResolveUdtAssetOptions): Promise<UdtAsset> {
  if (options.rawScript !== undefined) {
    const script = parseUdtTypeScript(options.rawScript, options.scriptOptionName);
    return script ? { kind: 'udt', script } : { kind: 'ckb' };
  }

  if (options.name !== undefined) {
    const info = await options.rpc.nodeInfo();
    const match = info.udt_cfg_infos.find((entry) => entry.name === options.name);
    if (!match) {
      throw new Error(`UDT name not found in node config: ${options.name}`);
    }
    return { kind: 'udt', script: match.script as UdtTypeScript, name: match.name };
  }

  return { kind: 'ckb' };
}
