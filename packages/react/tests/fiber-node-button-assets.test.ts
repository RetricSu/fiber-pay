import { DEFAULT_CKB_ASSET } from '@fiber-pay/sdk/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPanelAssetOptions,
  CKB_ASSET_KEY,
  CUSTOM_ASSET_KEY,
  formatRawUdtAmount,
  getAssetLabelForScript,
  getUdtAssetKey,
  localizeAssetLabel,
  resolvePanelAsset,
  tryResolvePanelAsset,
} from '../src/fiber-node-button/assets.js';
import { validUdtScript } from './fixtures/udt.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FiberNodeButton asset helpers', () => {
  it('always includes CKB for missing or empty node configuration', () => {
    expect(buildPanelAssetOptions(undefined, DEFAULT_CKB_ASSET)).toEqual([
      { key: CKB_ASSET_KEY, asset: DEFAULT_CKB_ASSET, label: 'CKB' },
    ]);
    expect(buildPanelAssetOptions(null, DEFAULT_CKB_ASSET)).toHaveLength(1);
    expect(buildPanelAssetOptions([], DEFAULT_CKB_ASSET)).toHaveLength(1);
  });

  it('warns and drops invalid configured and initial UDT scripts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const options = buildPanelAssetOptions(
      [{ name: 'Broken config', script: { ...validUdtScript, args: 'broken' } }],
      { kind: 'udt', name: 'Broken initial', script: { ...validUdtScript, code_hash: '0x00' } },
    );

    expect(options).toEqual([{ key: CKB_ASSET_KEY, asset: DEFAULT_CKB_ASSET, label: 'CKB' }]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('keeps the first configured name for duplicate scripts', () => {
    const options = buildPanelAssetOptions(
      [
        { name: 'First', script: validUdtScript },
        { name: 'Second', script: validUdtScript },
      ],
      DEFAULT_CKB_ASSET,
    );

    expect(options).toHaveLength(2);
    expect(options[1]?.label).toBe('First');
  });

  it('adds a valid initial UDT missing from node config and lets its name override config', () => {
    const initialOnly = buildPanelAssetOptions([], {
      kind: 'udt',
      name: 'Initial',
      script: validUdtScript,
    });
    expect(initialOnly.map((option) => option.label)).toEqual(['CKB', 'Initial']);

    const namedOverride = buildPanelAssetOptions([{ name: 'Configured', script: validUdtScript }], {
      kind: 'udt',
      name: 'Explicit',
      script: validUdtScript,
    });
    expect(namedOverride[1]?.label).toBe('Explicit');
  });

  it('generates distinct keys for different invalid scripts', () => {
    expect(getUdtAssetKey({ code_hash: 'first' })).not.toBe(
      getUdtAssetKey({ code_hash: 'second' }),
    );
  });

  it('resolves CKB, configured UDT, and custom UDT selections', () => {
    const options = buildPanelAssetOptions(
      [{ name: 'RUSD', script: validUdtScript }],
      DEFAULT_CKB_ASSET,
    );
    const udtKey = getUdtAssetKey(validUdtScript);

    expect(resolvePanelAsset(CKB_ASSET_KEY, '', options)).toEqual(DEFAULT_CKB_ASSET);
    expect(resolvePanelAsset(udtKey, '', options)).toEqual(options[1]?.asset);
    expect(resolvePanelAsset(CUSTOM_ASSET_KEY, JSON.stringify(validUdtScript), options)).toEqual({
      kind: 'udt',
      script: validUdtScript,
    });
  });

  it('reports resolution failures without discarding their errors', () => {
    const options = buildPanelAssetOptions([], DEFAULT_CKB_ASSET);

    expect(() => resolvePanelAsset(CUSTOM_ASSET_KEY, '', options)).toThrow(
      'Custom UDT script is required.',
    );
    expect(() => resolvePanelAsset(CUSTOM_ASSET_KEY, '{', options)).toThrow();
    expect(() => resolvePanelAsset('missing', '', options)).toThrow(
      'Selected asset is no longer available.',
    );

    const success = tryResolvePanelAsset(CKB_ASSET_KEY, '', options);
    expect(success).toEqual({ ok: true, asset: DEFAULT_CKB_ASSET });
    const failure = tryResolvePanelAsset('missing', '', options);
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.error.message).toBe('Selected asset is no longer available.');
    }
  });

  it('labels CKB, matched scripts, unmatched scripts, and case variants', () => {
    const options = buildPanelAssetOptions(
      [{ name: 'RUSD', script: validUdtScript }],
      DEFAULT_CKB_ASSET,
    );
    const caseVariant = {
      ...validUdtScript,
      code_hash: `0x${validUdtScript.code_hash.slice(2).toUpperCase()}`,
      args: `0x${validUdtScript.args.slice(2).toUpperCase()}`,
    };

    expect(getAssetLabelForScript(null, options)).toBe('CKB');
    expect(getAssetLabelForScript(undefined, options)).toBe('CKB');
    expect(getAssetLabelForScript(caseVariant, options)).toBe('RUSD');
    expect(getAssetLabelForScript({ ...validUdtScript, args: '0x01' }, options)).toBe('UDT');
  });

  it('formats only bounded unsigned decimal UDT values', () => {
    expect(formatRawUdtAmount('0')).toBe('0');
    expect(formatRawUdtAmount('100000000')).toBe('100,000,000');
    for (const invalid of ['', ' ', '-1', '+1', '0x64', '1.5', '1'.repeat(65)]) {
      expect(formatRawUdtAmount(invalid)).toBe(invalid);
    }
  });

  it('localizes only generic asset labels', () => {
    const t = vi.fn((key: string, fallback: string) => `${key}:${fallback}`);
    expect(localizeAssetLabel('CKB', t)).toBe('asset.ckb:CKB');
    expect(localizeAssetLabel('UDT', t)).toBe('asset.udt:UDT');
    expect(localizeAssetLabel('RUSD', t)).toBe('RUSD');
  });
});
