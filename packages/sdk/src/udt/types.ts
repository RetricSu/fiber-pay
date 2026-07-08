import type { HexString } from '../types/rpc.js';

export type UdtTypeScript = {
  code_hash: HexString;
  hash_type: 'type' | 'data' | 'data1' | 'data2';
  args: HexString;
};

export type UdtAsset =
  | { kind: 'ckb' }
  | { kind: 'udt'; script: UdtTypeScript; name?: string };
