import { describe, expect, it } from 'vitest';
import type { ResolvedBinaryPath } from '../src/lib/binary-path.js';
import { getNodeUpgradeMode, type NodeUpgradeMode } from '../src/lib/node-upgrade.js';

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

  it('uses custom-binary mode for configured binary paths', () => {
    const resolved = createResolvedBinary({
      source: 'configured-path',
      binaryPath: '/opt/fiber/custom/my-fnn',
      installDir: null,
      managedByBinaryManager: false,
    });

    const mode: NodeUpgradeMode = getNodeUpgradeMode(resolved);

    expect(mode).toBe('custom-binary');
  });
});
