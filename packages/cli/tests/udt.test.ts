import { describe, expect, it, vi } from 'vitest';
import { resolveUdtTypeScript } from '../src/lib/udt.js';

describe('resolveUdtTypeScript', () => {
  const makeRpc = (names: string[]) => ({
    nodeInfo: vi.fn().mockResolvedValue({
      udt_cfg_infos: names.map((name) => ({
        name,
        script: { code_hash: '0x1234', hash_type: 'type', args: `0x${name}` },
        cell_deps: [],
      })),
    }),
  });

  it('returns CKB when no UDT options are given', async () => {
    const result = await resolveUdtTypeScript({ rpc: makeRpc([]) as any });
    expect(result.unit).toBe('CKB');
    expect(result.script).toBeUndefined();
  });

  it('parses a raw JSON UDT script', async () => {
    const result = await resolveUdtTypeScript({
      rawScript: '{"code_hash":"0xabcd","hash_type":"data","args":"0x"}',
      rpc: makeRpc([]) as any,
    });
    expect(result.unit).toBe('UDT');
    expect(result.script).toEqual({ code_hash: '0xabcd', hash_type: 'data', args: '0x' });
  });

  it('resolves a UDT by name from node info', async () => {
    const result = await resolveUdtTypeScript({
      name: 'RUSD',
      rpc: makeRpc(['RUSD']) as any,
    });
    expect(result.unit).toBe('UDT');
    expect(result.name).toBe('RUSD');
    expect(result.script).toEqual({ code_hash: '0x1234', hash_type: 'type', args: '0xRUSD' });
  });

  it('throws with default option name when raw script is invalid JSON', async () => {
    await expect(
      resolveUdtTypeScript({ rawScript: 'not-json', rpc: makeRpc([]) as any }),
    ).rejects.toThrow('Invalid --udt-type-script: must be a valid JSON object');
  });

  it('uses custom scriptOptionName in raw script validation errors', async () => {
    await expect(
      resolveUdtTypeScript({
        rawScript: 'not-json',
        scriptOptionName: '--funding-udt-type-script',
        rpc: makeRpc([]) as any,
      }),
    ).rejects.toThrow('Invalid --funding-udt-type-script: must be a valid JSON object');
  });

  it('throws when named UDT is not found', async () => {
    await expect(
      resolveUdtTypeScript({ name: 'MISSING', rpc: makeRpc(['RUSD']) as any }),
    ).rejects.toThrow('UDT name not found');
  });
});
