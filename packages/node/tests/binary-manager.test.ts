import { describe, expect, it, vi } from 'vitest';
import { BinaryManager } from '../src/binary/manager.js';

describe('BinaryManager asset candidate selection', () => {
  it('prefers native macOS arm64 and includes x64 fallback for Apple Silicon', () => {
    const manager = new BinaryManager('/tmp/fiber-pay-test');
    vi.spyOn(manager, 'getPlatformInfo').mockReturnValue({ platform: 'darwin', arch: 'arm64' });

    const candidates = manager.buildAssetCandidates('v0.7.1');

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0].name).toContain('aarch64-darwin');
    expect(candidates[0].usesRosetta).toBe(false);

    const fallback = candidates.find((candidate) => candidate.name.includes('x86_64-darwin'));
    expect(fallback).toBeDefined();
    expect(fallback?.usesRosetta).toBe(true);
  });

  it('does not include x64 fallback for linux arm64', () => {
    const manager = new BinaryManager('/tmp/fiber-pay-test');
    vi.spyOn(manager, 'getPlatformInfo').mockReturnValue({ platform: 'linux', arch: 'arm64' });

    const candidates = manager.buildAssetCandidates('v0.7.1');

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => !candidate.name.includes('x86_64-linux'))).toBe(true);
    expect(candidates.every((candidate) => candidate.usesRosetta === false)).toBe(true);
  });
});

describe('BinaryManager version normalization', () => {
  it('accepts valid semver tags and adds v prefix when missing', () => {
    const manager = new BinaryManager('/tmp/fiber-pay-test');

    expect(manager.normalizeTag('0.7.1')).toBe('v0.7.1');
    expect(manager.normalizeTag('v0.7.1-rc.1')).toBe('v0.7.1-rc.1');
    expect(manager.normalizeTag('v0.7.1+build.1')).toBe('v0.7.1+build.1');
  });

  it('rejects malformed or path-like version inputs', () => {
    const manager = new BinaryManager('/tmp/fiber-pay-test');

    expect(() => manager.normalizeTag('')).toThrow(/Version cannot be empty/);
    expect(() => manager.normalizeTag('latest')).toThrow(/Invalid version format/);
    expect(() => manager.normalizeTag('v0.7.1/../../evil')).toThrow(/Invalid version format/);
    expect(() => manager.normalizeTag('v0.7')).toThrow(/Invalid version format/);
  });
});
