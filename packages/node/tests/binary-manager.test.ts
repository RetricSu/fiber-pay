import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinaryManager, parseBinaryVersion } from '../src/binary/manager.js';

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

describe('parseBinaryVersion', () => {
  it('extracts a stable version', () => {
    expect(parseBinaryVersion('fnn Fiber v0.7.1 (f761b6d 2026-01-14)')).toBe('0.7.1');
  });

  it('preserves a hyphenated pre-release suffix', () => {
    expect(parseBinaryVersion('fnn Fiber v0.9.0-rc4 (abc1234 2026-06-20)')).toBe('0.9.0-rc4');
  });

  it('preserves a dotted pre-release suffix', () => {
    expect(parseBinaryVersion('fnn Fiber v0.9.0-rc.1 (abc1234)')).toBe('0.9.0-rc.1');
  });

  it('preserves build metadata', () => {
    expect(parseBinaryVersion('fnn Fiber v0.7.1+build.1 (abc1234)')).toBe('0.7.1+build.1');
  });

  it('returns null when no version-like token is present', () => {
    expect(parseBinaryVersion('fnn Fiber (no version string)')).toBeNull();
  });
});

function mockFetchResponse(): Response {
  return {
    ok: true,
    headers: { get: () => '0' },
    body: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) },
  } as unknown as Response;
}

describe('BinaryManager download version handling', () => {
  const tmpDir = '/tmp/fiber-pay-download-test';
  let manager: BinaryManager;
  let binaryPath: string;

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    manager = new BinaryManager(tmpDir);
    vi.spyOn(manager, 'getPlatformInfo').mockReturnValue({ platform: 'linux', arch: 'x64' });
    binaryPath = manager.getBinaryPath();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips download when installed version matches requested version', async () => {
    writeFileSync(binaryPath, 'dummy');
    vi.spyOn(manager, 'getBinaryInfo').mockResolvedValue({
      path: binaryPath,
      version: '0.9.0-rc4',
      ready: true,
    });
    vi.stubGlobal('fetch', vi.fn());

    const info = await manager.download({ version: '0.9.0-rc4' });

    expect(fetch).not.toHaveBeenCalled();
    expect(info.version).toBe('0.9.0-rc4');
  });

  it('re-downloads when installed version differs from requested version', async () => {
    writeFileSync(binaryPath, 'dummy');
    vi.spyOn(manager, 'getBinaryInfo')
      .mockResolvedValueOnce({ path: binaryPath, version: '0.7.1', ready: true })
      .mockResolvedValueOnce({ path: binaryPath, version: '0.9.0-rc4', ready: true });
    vi.spyOn(manager as never, 'extractTarGz').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse()));

    const info = await manager.download({ version: '0.9.0-rc4' });

    expect(fetch).toHaveBeenCalled();
    expect(info.version).toBe('0.9.0-rc4');
  });

  it('throws when the installed binary reports the wrong version after download', async () => {
    vi.spyOn(manager, 'getBinaryInfo').mockResolvedValue({
      path: binaryPath,
      version: '0.7.1',
      ready: true,
    });
    vi.spyOn(manager as never, 'extractTarGz').mockImplementation(async () => {
      writeFileSync(binaryPath, 'dummy');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse()));

    await expect(manager.download({ version: '0.9.0-rc4' })).rejects.toThrow(/Version mismatch/);
  });

  it('returns the binary info when the installed version matches after download', async () => {
    vi.spyOn(manager, 'getBinaryInfo').mockResolvedValue({
      path: binaryPath,
      version: '0.9.0-rc4',
      ready: true,
    });
    vi.spyOn(manager as never, 'extractTarGz').mockImplementation(async () => {
      writeFileSync(binaryPath, 'dummy');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse()));

    const info = await manager.download({ version: '0.9.0-rc4' });

    expect(info.version).toBe('0.9.0-rc4');
    expect(info.ready).toBe(true);
  });
});

function createFakeBinary(path: string, script: string): void {
  writeFileSync(path, script);
  chmodSync(path, 0o755);
}

describe('BinaryManager getBinaryInfo', () => {
  const tmpDir = '/tmp/fiber-pay-getinfo-test';
  let manager: BinaryManager;
  let binaryPath: string;

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    manager = new BinaryManager(tmpDir);
    vi.spyOn(manager, 'getPlatformInfo').mockReturnValue({ platform: 'linux', arch: 'x64' });
    binaryPath = manager.getBinaryPath();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ready=true with parsed version for a working binary', async () => {
    createFakeBinary(binaryPath, '#!/bin/sh\necho "fnn Fiber v0.9.0-rc4 (abc1234 2026-06-20)"');
    const info = await manager.getBinaryInfo();
    expect(info.ready).toBe(true);
    expect(info.version).toBe('0.9.0-rc4');
    expect(info.path).toBe(binaryPath);
  });

  it('returns ready=false when the binary exists but fails to run', async () => {
    createFakeBinary(binaryPath, '#!/bin/sh\nexit 1');
    const info = await manager.getBinaryInfo();
    expect(info.ready).toBe(false);
    expect(info.version).toBe('unknown');
  });

  it('returns ready=false when the binary does not exist', async () => {
    const info = await manager.getBinaryInfo();
    expect(info.ready).toBe(false);
    expect(info.version).toBe('unknown');
    expect(info.path).toBe(binaryPath);
  });

  it('falls back to trimmed stdout when parseBinaryVersion returns null', async () => {
    createFakeBinary(binaryPath, '#!/bin/sh\necho "no version here"');
    const info = await manager.getBinaryInfo();
    expect(info.ready).toBe(true);
    expect(info.version).toBe('no version here');
  });
});

describe('BinaryManager download error handling', () => {
  const tmpDir = '/tmp/fiber-pay-download-err-test';
  let manager: BinaryManager;
  let binaryPath: string;

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    manager = new BinaryManager(tmpDir);
    vi.spyOn(manager, 'getPlatformInfo').mockReturnValue({ platform: 'linux', arch: 'x64' });
    binaryPath = manager.getBinaryPath();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('forces re-download when force=true even if the installed version matches', async () => {
    writeFileSync(binaryPath, 'dummy');
    vi.spyOn(manager, 'getBinaryInfo').mockResolvedValue({
      path: binaryPath,
      version: '0.9.0-rc4',
      ready: true,
    });
    vi.spyOn(manager as never, 'extractTarGz').mockImplementation(async () => {
      writeFileSync(binaryPath, 'dummy');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse()));

    const info = await manager.download({ version: '0.9.0-rc4', force: true });

    expect(fetch).toHaveBeenCalled();
    expect(info.version).toBe('0.9.0-rc4');
  });

  it('throws when all download candidates fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, headers: { get: () => null } } as unknown as Response),
    );

    await expect(manager.download({ version: '0.9.0-rc4' })).rejects.toThrow(/Download failed/);
  });

  it('throws when the response has no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => '0' },
        body: null,
      } as unknown as Response),
    );

    await expect(manager.download({ version: '0.9.0-rc4' })).rejects.toThrow(/No response body/);
  });

  it('propagates errors from the archive extraction step', async () => {
    vi.spyOn(manager as never, 'extractTarGz').mockRejectedValue(new Error('extract boom'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse()));

    await expect(manager.download({ version: '0.9.0-rc4' })).rejects.toThrow(/extract boom/);
  });
});
