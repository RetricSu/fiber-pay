import { basename, dirname, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResolvedBinaryPath } from '../src/lib/binary-path.js';
import {
  getMigrateBinaryPathForBinary,
  getNodeUpgradeMode,
  type NodeUpgradeMode,
} from '../src/lib/node-upgrade.js';

function createResolvedBinary(overrides: Partial<ResolvedBinaryPath> = {}): ResolvedBinaryPath {
  return {
    binaryPath: '/tmp/fiber-pay/bin/fnn',
    installDir: '/tmp/fiber-pay/bin',
    managedPath: '/tmp/fiber-pay/bin/fnn',
    managedByBinaryManager: true,
    source: 'profile-managed',
    ...overrides,
  };
}

describe('node upgrade mode', () => {
  it('uses managed-download mode for profile-managed binary paths', () => {
    const resolved = createResolvedBinary();

    const mode: NodeUpgradeMode = getNodeUpgradeMode(resolved);

    expect(mode).toBe('managed-download');
  });

  it('uses custom-migrate-only mode for configured binary paths', () => {
    const resolved = createResolvedBinary({
      source: 'configured-path',
      binaryPath: '/opt/fiber/custom/my-fnn',
      installDir: null,
      managedByBinaryManager: false,
    });

    const mode: NodeUpgradeMode = getNodeUpgradeMode(resolved);

    expect(mode).toBe('custom-migrate-only');
  });

  it('resolves fnn-migrate path from configured binary directory', () => {
    const binaryPath = '/opt/fiber/custom/my-fnn';
    const migratePath = getMigrateBinaryPathForBinary(binaryPath);

    expect(normalize(dirname(migratePath))).toBe(normalize(dirname(binaryPath)));
    expect(basename(migratePath)).toBe(process.platform === 'win32' ? 'fnn-migrate.exe' : 'fnn-migrate');
  });

  it('rejects bare command names for migrate path derivation', () => {
    expect(() => getMigrateBinaryPathForBinary('fnn')).toThrow(
      /must include an explicit directory path/i,
    );
  });
});
