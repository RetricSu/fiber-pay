import { resolveUdtAsset } from '@fiber-pay/sdk';
import { describe, expect, it, vi } from 'vitest';

const MOCK_CODE_HASH =
  '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a';

describe('resolveUdtAsset', () => {
  const makeRpc = (names: string[]) => ({
    nodeInfo: vi.fn().mockResolvedValue({
      udt_cfg_infos: names.map((name) => ({
        name,
        script: { code_hash: MOCK_CODE_HASH, hash_type: 'type', args: '0x00' },
        cell_deps: [],
      })),
    }),
  });

  it('returns CKB when no UDT options are given', async () => {
    const result = await resolveUdtAsset({ rpc: makeRpc([]) as never });
    expect(result.kind).toBe('ckb');
  });

  it('parses a raw JSON UDT script', async () => {
    const result = await resolveUdtAsset({
      rawScript: `{"code_hash":"${MOCK_CODE_HASH}","hash_type":"data","args":"0x"}`,
      rpc: makeRpc([]) as never,
    });
    expect(result.kind).toBe('udt');
    expect(result).toEqual({
      kind: 'udt',
      script: { code_hash: MOCK_CODE_HASH, hash_type: 'data', args: '0x' },
    });
  });

  it('resolves a UDT by name from node info', async () => {
    const result = await resolveUdtAsset({
      name: 'RUSD',
      rpc: makeRpc(['RUSD']) as never,
    });
    expect(result.kind).toBe('udt');
    expect(result).toEqual({
      kind: 'udt',
      name: 'RUSD',
      script: { code_hash: MOCK_CODE_HASH, hash_type: 'type', args: '0x00' },
    });
  });

  it('throws with default option name when raw script is invalid JSON', async () => {
    await expect(
      resolveUdtAsset({ rawScript: 'not-json', rpc: makeRpc([]) as never }),
    ).rejects.toThrow('Invalid --udt-type-script: must be a valid JSON object');
  });

  it('uses custom scriptOptionName in raw script validation errors', async () => {
    await expect(
      resolveUdtAsset({
        rawScript: 'not-json',
        scriptOptionName: '--funding-udt-type-script',
        rpc: makeRpc([]) as never,
      }),
    ).rejects.toThrow('Invalid --funding-udt-type-script: must be a valid JSON object');
  });

  it('throws when named UDT is not found', async () => {
    await expect(
      resolveUdtAsset({ name: 'MISSING', rpc: makeRpc(['RUSD']) as never }),
    ).rejects.toThrow('UDT name not found');
  });
});
