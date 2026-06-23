import type { BinaryManager } from '@fiber-pay/node';
import { DEFAULT_FIBER_VERSION } from '@fiber-pay/node';
import type { ProfileConfig } from './config.js';

export type ManagedStartVersionSource = 'profile' | 'default';

export interface ManagedStartVersionDecision {
  version: string | undefined;
  source: ManagedStartVersionSource;
}

export type ManagedUpgradeVersionSource = 'requested' | 'default';

export interface ManagedUpgradeVersionDecision {
  targetTag: string;
  targetVersion: string;
  source: ManagedUpgradeVersionSource;
}

export function stripVersionPrefix(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

export function normalizeTargetVersion(
  binaryManager: BinaryManager,
  version: string,
): Pick<ManagedUpgradeVersionDecision, 'targetTag' | 'targetVersion'> {
  const targetTag = binaryManager.normalizeTag(version);
  return {
    targetTag,
    targetVersion: stripVersionPrefix(targetTag),
  };
}

export function resolveManagedUpgradeVersion(
  binaryManager: BinaryManager,
  requestedVersion?: string,
): ManagedUpgradeVersionDecision {
  if (requestedVersion) {
    const normalized = normalizeTargetVersion(binaryManager, requestedVersion);
    return { ...normalized, source: 'requested' };
  }

  const targetTag = binaryManager.normalizeTag(DEFAULT_FIBER_VERSION);
  return {
    targetTag,
    targetVersion: stripVersionPrefix(targetTag),
    source: 'default',
  };
}

export function resolveManagedStartVersion(
  profile: ProfileConfig | undefined,
): ManagedStartVersionDecision {
  const raw = profile?.fiberVersion;
  const version = raw && raw.trim().length > 0 ? raw.trim() : undefined;

  return {
    version,
    source: version ? 'profile' : 'default',
  };
}
