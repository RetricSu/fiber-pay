import { describe, expect, it } from 'vitest';
import {
  formatAssetName,
  formatChannelBalances,
  parseFundingAmount,
  parsePaymentAmount,
  parseUdtTypeScript,
  resolveUdtAsset,
  validateUdtTypeScript,
  type UdtAsset,
} from '../src/udt/index.js';
import type { Channel, UdtCfgInfos } from '../src/types/rpc.js';

const validCodeHash = '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a';
const validUdtScript =
  `{"code_hash":"${validCodeHash}","hash_type":"type","args":"0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b"}`;

describe('parseUdtTypeScript', () => {
  it('returns undefined when value is undefined', () => {
    expect(parseUdtTypeScript(undefined)).toBeUndefined();
  });

  it('parses a valid UDT type script', () => {
    expect(parseUdtTypeScript(validUdtScript)).toEqual({
      code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
      hash_type: 'type',
      args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
    });
  });

  it('rejects invalid JSON', () => {
    expect(() => parseUdtTypeScript('not-json', '--test')).toThrow(
      'Invalid --test: must be a valid JSON object',
    );
  });

  it('rejects missing code_hash', () => {
    expect(() => parseUdtTypeScript('{"hash_type":"type","args":"0x"}')).toThrow(
      'code_hash must be a hex string starting with 0x',
    );
  });

  it('rejects invalid hash_type', () => {
    expect(() =>
      parseUdtTypeScript(
        `{"code_hash":"${validCodeHash}","hash_type":"invalid","args":"0x"}`,
      ),
    ).toThrow('hash_type must be one of type, data, data1, data2');
  });

  it('rejects args without 0x prefix', () => {
    expect(() =>
      parseUdtTypeScript(`{"code_hash":"${validCodeHash}","hash_type":"type","args":"00"}`),
    ).toThrow('args must be a hex string starting with 0x');
  });

  it('rejects code_hash with wrong length', () => {
    expect(() => parseUdtTypeScript('{"code_hash":"0x00","hash_type":"type","args":"0x"}')).toThrow(
      'code_hash must be 66 hex characters',
    );
  });

  it('rejects oversized input', () => {
    const oversized = '{"code_hash":"' + '0'.repeat(5000) + '","hash_type":"type","args":"0x"}';
    expect(() => parseUdtTypeScript(oversized)).toThrow('input exceeds maximum length');
  });
});

describe('validateUdtTypeScript', () => {
  it('validates a valid script object', () => {
    expect(
      validateUdtTypeScript({
        code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
        hash_type: 'type',
        args: '0x00',
      }),
    ).toEqual({
      code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
      hash_type: 'type',
      args: '0x00',
    });
  });

  it('rejects invalid script object', () => {
    expect(() => validateUdtTypeScript({ code_hash: '0x00', hash_type: 'type', args: '0x' })).toThrow(
      'code_hash must be 66 hex characters',
    );
  });
});

describe('parsePaymentAmount', () => {
  it('converts CKB decimal to shannons', () => {
    expect(parsePaymentAmount('1.5', { kind: 'ckb' })).toBe(150_000_000n);
  });

  it('accepts CKB amounts with trailing zeros beyond 8 decimals', () => {
    expect(parsePaymentAmount('1.000000000', { kind: 'ckb' })).toBe(100_000_000n);
    expect(parsePaymentAmount('1.123000000', { kind: 'ckb' })).toBe(112_300_000n);
  });

  it('rejects CKB amounts with non-zero digits beyond 8 decimals', () => {
    expect(() => parsePaymentAmount('1.123456789', { kind: 'ckb' })).toThrow(
      'with at most 8 decimal places',
    );
  });

  it('converts UDT integer to raw units', () => {
    expect(parsePaymentAmount('1000', { kind: 'udt', script: {} as never })).toBe(1000n);
  });

  it('rejects zero CKB amount', () => {
    expect(() => parsePaymentAmount('0', { kind: 'ckb' })).toThrow('CKB amount must be greater than 0');
  });

  it('rejects zero UDT amount', () => {
    expect(() => parsePaymentAmount('0', { kind: 'udt', script: {} as never })).toThrow(
      'UDT amount must be greater than 0',
    );
  });

  it('rejects UDT decimal amount', () => {
    expect(() => parsePaymentAmount('1.5', { kind: 'udt', script: {} as never })).toThrow(
      'positive integer in the smallest UDT unit',
    );
  });
});

describe('parseFundingAmount', () => {
  it('allows zero CKB funding amount', () => {
    expect(parseFundingAmount('0', { kind: 'ckb' })).toBe(0n);
  });

  it('allows zero UDT funding amount', () => {
    expect(parseFundingAmount('0', { kind: 'udt', script: {} as never })).toBe(0n);
  });

  it('converts CKB decimal to shannons', () => {
    expect(parseFundingAmount('2', { kind: 'ckb' })).toBe(200_000_000n);
  });

  it('rejects negative UDT funding amount', () => {
    expect(() => parseFundingAmount('-1', { kind: 'udt', script: {} as never })).toThrow(
      'Expected a non-negative integer',
    );
  });
});

describe('resolveUdtAsset', () => {
  const mockUdtCfgInfos: UdtCfgInfos = [
    {
      name: 'RUSD',
      script: {
        code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
        hash_type: 'type',
        args: '0x00',
      },
      auto_accept_amount: '0x0',
      cell_deps: [],
    },
  ];

  const rpc = {
    nodeInfo: async () => ({ udt_cfg_infos: mockUdtCfgInfos }),
  };

  it('defaults to CKB when no script or name is provided', async () => {
    await expect(resolveUdtAsset({ rpc })).resolves.toEqual({ kind: 'ckb' });
  });

  it('resolves by raw script', async () => {
    await expect(
      resolveUdtAsset({ rawScript: validUdtScript, scriptOptionName: '--test', rpc }),
    ).resolves.toEqual({
      kind: 'udt',
      script: {
        code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
        hash_type: 'type',
        args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
      },
    });
  });

  it('resolves by name', async () => {
    await expect(resolveUdtAsset({ name: 'RUSD', rpc })).resolves.toEqual({
      kind: 'udt',
      script: mockUdtCfgInfos[0].script,
      name: 'RUSD',
    });
  });

  it('throws when name is not found', async () => {
    await expect(resolveUdtAsset({ name: 'UNKNOWN', rpc })).rejects.toThrow(
      'UDT name not found in node config: UNKNOWN',
    );
  });

  it('does not require rpc when resolving by raw script', async () => {
    await expect(
      resolveUdtAsset({ rawScript: validUdtScript, scriptOptionName: '--test' }),
    ).resolves.toEqual({
      kind: 'udt',
      script: {
        code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
        hash_type: 'type',
        args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
      },
    });
  });

  it('throws when resolving by name without rpc', async () => {
    await expect(resolveUdtAsset({ name: 'RUSD' })).rejects.toThrow(
      'RPC client is required to resolve UDT by name',
    );
  });

  it('validates RPC-returned UDT scripts', async () => {
    const badRpc = {
      nodeInfo: async () => ({
        udt_cfg_infos: [
          {
            name: 'BAD',
            script: { code_hash: '0x00', hash_type: 'type', args: '0x' },
            auto_accept_amount: '0x0',
            cell_deps: [],
          },
        ],
      }),
    };
    await expect(resolveUdtAsset({ name: 'BAD', rpc: badRpc })).rejects.toThrow(
      'code_hash must be 66 hex characters',
    );
  });
});

describe('formatChannelBalances', () => {
  const baseChannel = {
    channel_id: '0x1234',
    peer_id: '0xabcd',
    state: { state_name: 'ChannelReady' as const, state_flags: [] },
  } as unknown as Channel;

  it('formats CKB channel with conversion', () => {
    const channel: Channel = {
      ...baseChannel,
      local_balance: '0x989680',
      remote_balance: '0x1312d00',
      funding_udt_type_script: null,
    };
    const result = formatChannelBalances(channel);
    expect(result.kind).toBe('ckb');
    expect(result.local).toBe(0.1);
    expect(result.remote).toBe(0.2);
    expect(result.capacity).toBe(0.3);
    expect(result.fundingUdtTypeScript).toBeUndefined();
  });

  it('formats UDT channel with raw units', () => {
    const channel: Channel = {
      ...baseChannel,
      local_balance: '0x3e8',
      remote_balance: '0x7d0',
      funding_udt_type_script: {
        code_hash: '0x00',
        hash_type: 'type',
        args: '0x00',
      },
    };
    const result = formatChannelBalances(channel);
    expect(result.kind).toBe('udt');
    expect(result.local).toBe('1000');
    expect(result.remote).toBe('2000');
    expect(result.capacity).toBe('3000');
    expect(result.fundingUdtTypeScript).toEqual(channel.funding_udt_type_script);
  });
});

describe('formatAssetName', () => {
  it('returns CKB for CKB asset', () => {
    expect(formatAssetName({ kind: 'ckb' })).toBe('CKB');
  });

  it('returns trimmed UDT name when available', () => {
    expect(formatAssetName({ kind: 'udt', script: {} as never, name: '  RUSD  ' })).toBe('RUSD');
  });

  it('falls back to UDT when name is missing or empty', () => {
    expect(formatAssetName({ kind: 'udt', script: {} as never })).toBe('UDT');
    expect(formatAssetName({ kind: 'udt', script: {} as never, name: '   ' })).toBe('UDT');
  });
});
