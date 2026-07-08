import type { Script, UdtCfgInfos } from '@fiber-pay/sdk';
import { parseUdtTypeScript } from './parse-options.js';

export interface UdtResolution {
  script?: Script;
  unit: 'CKB' | 'UDT';
  name?: string;
}

export interface UdtResolutionOptions {
  rawScript?: string;
  name?: string;
  rpc: { nodeInfo(): Promise<{ udt_cfg_infos: UdtCfgInfos }> };
}

export async function resolveUdtTypeScript(options: UdtResolutionOptions): Promise<UdtResolution> {
  if (options.rawScript !== undefined) {
    const script = parseUdtTypeScript(options.rawScript, '--udt-type-script');
    if (script === undefined) {
      return { unit: 'CKB' };
    }
    return { script, unit: 'UDT' };
  }

  if (options.name !== undefined) {
    const info = await options.rpc.nodeInfo();
    const match = info.udt_cfg_infos.find((entry) => entry.name === options.name);
    if (!match) {
      throw new Error(`UDT name not found in node config: ${options.name}`);
    }
    return { script: match.script, unit: 'UDT', name: match.name };
  }

  return { unit: 'CKB' };
}
