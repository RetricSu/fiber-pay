import type { CellDep, HexString, Script } from '../types/rpc.js';
import { normalizeCkbTransactionForRpc } from './ckb-transaction-normalizer.js';

export interface CccKnownScriptCellDepLike {
  cellDep: {
    outPoint: {
      txHash: string;
      index: unknown;
    };
    depType: 'code' | 'depGroup';
  };
}

export interface CccKnownScriptInfoLike {
  codeHash: string;
  hashType: 'type' | 'data' | 'data1' | 'data2';
  cellDeps: CccKnownScriptCellDepLike[];
}

export interface CccScriptLike {
  codeHash: string;
  hashType: 'type' | 'data' | 'data1' | 'data2';
  args: string;
}

type BivariantSignTransaction = {
  bivarianceHack(tx: unknown): Promise<unknown>;
}['bivarianceHack'];

type BivariantGetKnownScript = {
  bivarianceHack(knownScript: string): Promise<CccKnownScriptInfoLike>;
}['bivarianceHack'];

export interface CccSignerLike {
  signTransaction: BivariantSignTransaction;
  client: {
    getKnownScript: BivariantGetKnownScript;
  };
}

export interface CreateCccSignFundingTxOptions {
  toRpcTransaction?: (signedTx: unknown) => Record<string, unknown>;
}

function toHexPrefixed(value: string): HexString {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Hex value is empty.');
  }

  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as HexString;
}

function cccOutPointIndexToHex(index: unknown): HexString {
  const bigintValue = typeof index === 'bigint' ? index : BigInt(String(index));
  return `0x${bigintValue.toString(16)}` as HexString;
}

function cccCellDepToFiberCellDep(dep: {
  outPoint: {
    txHash: string;
    index: unknown;
  };
  depType: 'code' | 'depGroup';
}): CellDep {
  return {
    out_point: {
      tx_hash: toHexPrefixed(dep.outPoint.txHash),
      index: cccOutPointIndexToHex(dep.outPoint.index),
    },
    dep_type: dep.depType === 'depGroup' ? 'dep_group' : 'code',
  };
}

export function cccScriptToFiberScript(script: CccScriptLike): Script {
  return {
    code_hash: toHexPrefixed(script.codeHash),
    hash_type: script.hashType,
    args: toHexPrefixed(script.args),
  };
}

export async function resolveFundingLockCellDepsByKnownScript(
  signer: CccSignerLike,
  script: Script,
  knownScripts: readonly string[],
): Promise<{ knownScript: string; cellDeps: CellDep[] } | null> {
  const scriptCodeHash = script.code_hash.toLowerCase();
  const scriptHashType = script.hash_type;

  for (const knownScript of knownScripts) {
    try {
      const scriptInfo = await signer.client.getKnownScript(knownScript);
      if (
        scriptInfo.codeHash.toLowerCase() !== scriptCodeHash ||
        scriptInfo.hashType !== scriptHashType
      ) {
        continue;
      }

      const cellDeps = scriptInfo.cellDeps.map((depInfo) =>
        cccCellDepToFiberCellDep(depInfo.cellDep),
      );
      return {
        knownScript,
        cellDeps,
      };
    } catch {
      // Ignore unresolved scripts and continue matching by code hash/hash type.
    }
  }

  return null;
}

export function createCccSignFundingTx(
  signer: CccSignerLike,
  options: CreateCccSignFundingTxOptions = {},
) {
  const toRpcTransaction =
    options.toRpcTransaction ??
    ((signedTx: unknown) => normalizeCkbTransactionForRpc(signedTx) as Record<string, unknown>);

  return async (txForSigner: unknown): Promise<Record<string, unknown>> => {
    const signedTx = await signer.signTransaction(txForSigner);
    return toRpcTransaction(signedTx);
  };
}
