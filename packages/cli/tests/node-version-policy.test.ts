import { BinaryManager } from '@fiber-pay/node';
import { describe, expect, it } from 'vitest';
import {
  normalizeTargetVersion,
  resolveManagedStartVersion,
  resolveManagedUpgradeVersion,
} from '../src/lib/node-version-policy.js';

describe('node version policy', () => {
  it('uses profile fiberVersion for managed start when available', () => {
    const decision = resolveManagedStartVersion({ fiberVersion: '0.9.0-rc4' });

    expect(decision.version).toBe('0.9.0-rc4');
    expect(decision.source).toBe('profile');
  });

  it('falls back to default-managed start version source when profile version is missing', () => {
    const decision = resolveManagedStartVersion(undefined);

    expect(decision.version).toBeUndefined();
    expect(decision.source).toBe('default');
  });

  it('normalizes requested upgrade version tags', () => {
    const manager = new BinaryManager('/tmp/fiber-pay-test-bin');
    const normalized = normalizeTargetVersion(manager, '0.9.0-rc4');

    expect(normalized.targetTag).toBe('v0.9.0-rc4');
    expect(normalized.targetVersion).toBe('0.9.0-rc4');
  });

  it('resolves managed upgrade version from explicit request', async () => {
    const manager = new BinaryManager('/tmp/fiber-pay-test-bin');
    const decision = await resolveManagedUpgradeVersion(manager, 'v0.9.0-rc4');

    expect(decision.targetTag).toBe('v0.9.0-rc4');
    expect(decision.targetVersion).toBe('0.9.0-rc4');
    expect(decision.source).toBe('requested');
  });

  it('resolves managed upgrade version from bundled default when not requested', () => {
    const manager = new BinaryManager('/tmp/fiber-pay-test-bin');

    const decision = resolveManagedUpgradeVersion(manager);

    expect(decision.targetTag).toBe('v0.9.0-rc4');
    expect(decision.targetVersion).toBe('0.9.0-rc4');
    expect(decision.source).toBe('default');
  });
});
