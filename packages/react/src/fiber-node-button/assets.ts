import type { Script, UdtAsset, UdtTypeScript } from '@fiber-pay/sdk/browser';
import {
  DEFAULT_CKB_ASSET,
  parseUdtTypeScript,
  validateUdtTypeScript,
} from '@fiber-pay/sdk/browser';

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
  if (!script || typeof script !== 'object') {
    return 'udt:invalid';
  }

  const record = script as Record<string, unknown>;
  return `udt:${String(record.code_hash ?? '')}:${String(record.hash_type ?? '')}:${String(
    record.args ?? '',
  )}`.toLowerCase();
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
      options.set(key, {
        key,
        asset,
        label: configured.name?.trim() || 'UDT',
      });
    } catch {
      // Invalid node config entries cannot be used safely as an action asset.
    }
  }

  if (initialAsset.kind === 'udt') {
    const key = getAssetKey(initialAsset);
    const existing = options.get(key);
    const preferredAsset = initialAsset.name?.trim()
      ? initialAsset
      : (existing?.asset ?? initialAsset);
    options.set(key, {
      key,
      asset: preferredAsset,
      label: initialAsset.name?.trim() || existing?.label || 'UDT',
    });
  }

  return Array.from(options.values());
}

export function resolvePanelAsset(
  key: string,
  customScript: string,
  options: ReadonlyArray<PanelAssetOption>,
): UdtAsset {
  if (key === CUSTOM_ASSET_KEY) {
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

export function tryResolvePanelAsset(
  key: string,
  customScript: string,
  options: ReadonlyArray<PanelAssetOption>,
): UdtAsset | null {
  try {
    return resolvePanelAsset(key, customScript, options);
  } catch {
    return null;
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
  try {
    return BigInt(value).toLocaleString('en-US');
  } catch {
    return value;
  }
}
