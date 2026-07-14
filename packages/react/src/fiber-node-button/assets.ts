import type { Script, UdtAsset, UdtTypeScript } from '@fiber-pay/sdk/browser';
import {
  DEFAULT_CKB_ASSET,
  parseUdtTypeScript,
  validateUdtTypeScript,
} from '@fiber-pay/sdk/browser';
import type { FiberNodeButtonI18n } from './types.js';

export const CKB_ASSET_KEY = 'ckb';
export const CUSTOM_ASSET_KEY = 'custom';

export interface PanelAssetOption {
  key: string;
  asset: UdtAsset;
  label: string;
}

interface ConfiguredUdt {
  name?: string;
  script: unknown;
}

function getRawScriptKey(script: unknown): string {
  try {
    const validated = validateUdtTypeScript(script);
    return `udt:${validated.code_hash}:${validated.hash_type}:${validated.args}`.toLowerCase();
  } catch {
    let serialized: string;
    try {
      serialized = JSON.stringify(script) ?? String(script);
    } catch {
      serialized = String(script);
    }
    return `udt:invalid:${serialized}`.toLowerCase();
  }
}

export function getUdtAssetKey(script: unknown): string {
  return getRawScriptKey(script);
}

export function getAssetKey(asset: UdtAsset): string {
  return asset.kind === 'ckb' ? CKB_ASSET_KEY : getUdtAssetKey(asset.script);
}

export function getChannelAssetKey(script: Script | null | undefined): string {
  return script ? getUdtAssetKey(script) : CKB_ASSET_KEY;
}

export function buildPanelAssetOptions(
  configuredUdts: ReadonlyArray<ConfiguredUdt> | null | undefined,
  initialAsset: UdtAsset,
): PanelAssetOption[] {
  const options = new Map<string, PanelAssetOption>();
  options.set(CKB_ASSET_KEY, {
    key: CKB_ASSET_KEY,
    asset: DEFAULT_CKB_ASSET,
    label: 'CKB',
  });

  for (const configured of configuredUdts ?? []) {
    try {
      const script = validateUdtTypeScript(configured.script, 'node UDT config');
      const asset: UdtAsset = {
        kind: 'udt',
        script,
        name: configured.name?.trim() || undefined,
      };
      const key = getAssetKey(asset);
      if (!options.has(key)) {
        options.set(key, {
          key,
          asset,
          label: configured.name?.trim() || 'UDT',
        });
      }
    } catch (error) {
      console.warn(
        '[FiberNodeButton] Ignoring invalid node UDT configuration.',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (initialAsset.kind === 'udt') {
    try {
      const script = validateUdtTypeScript(initialAsset.script, 'initial UDT asset');
      const validatedInitialAsset: UdtAsset = {
        kind: 'udt',
        script,
        name: initialAsset.name?.trim() || undefined,
      };
      const key = getAssetKey(validatedInitialAsset);
      const existing = options.get(key);
      const preferredAsset = validatedInitialAsset.name
        ? validatedInitialAsset
        : (existing?.asset ?? validatedInitialAsset);
      options.set(key, {
        key,
        asset: preferredAsset,
        label: validatedInitialAsset.name || existing?.label || 'UDT',
      });
    } catch (error) {
      console.warn(
        '[FiberNodeButton] Ignoring invalid initial UDT asset.',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return Array.from(options.values());
}

export function resolvePanelAsset(
  key: string,
  customScript: string,
  options: ReadonlyArray<PanelAssetOption>,
): UdtAsset {
  if (key === CUSTOM_ASSET_KEY) {
    if (!customScript.trim()) {
      throw new Error('Custom UDT script is required.');
    }
    const script = parseUdtTypeScript(customScript, 'custom UDT script');
    if (!script) {
      throw new Error('Custom UDT script is required.');
    }
    return { kind: 'udt', script };
  }

  const option = options.find((candidate) => candidate.key === key);
  if (!option) {
    throw new Error('Selected asset is no longer available.');
  }
  return option.asset;
}

export type PanelAssetResolution = { ok: true; asset: UdtAsset } | { ok: false; error: Error };

export function tryResolvePanelAsset(
  key: string,
  customScript: string,
  options: ReadonlyArray<PanelAssetOption>,
): PanelAssetResolution {
  try {
    return { ok: true, asset: resolvePanelAsset(key, customScript, options) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export function getAssetLabelForScript(
  script: UdtTypeScript | Script | null | undefined,
  options: ReadonlyArray<PanelAssetOption>,
): string {
  if (!script) {
    return 'CKB';
  }
  const key = getUdtAssetKey(script);
  return options.find((option) => option.key === key)?.label || 'UDT';
}

export function formatRawUdtAmount(value: string): string {
  if (value.length > 64 || !/^\d+$/.test(value)) {
    return value;
  }

  try {
    return BigInt(value).toLocaleString('en-US');
  } catch {
    return value;
  }
}

export function localizeAssetLabel(label: string, t: FiberNodeButtonI18n): string {
  if (label === 'CKB') return t('asset.ckb', 'CKB');
  if (label === 'UDT') return t('asset.udt', 'UDT');
  return label;
}
