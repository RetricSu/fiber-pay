import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { resolveStorePath, storeExists } from '../src/migration/store.js';

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `fiber-pay-test-${prefix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('migration store utilities', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('migration-store');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves store path under dataDir/fiber/store', () => {
    expect(resolveStorePath('/home/user/.fiber-pay')).toBe(
      join('/home/user/.fiber-pay', 'fiber', 'store'),
    );
  });

  it('returns false when store does not exist', () => {
    expect(storeExists(tempDir)).toBe(false);
  });

  it('returns true when store directory exists', () => {
    mkdirSync(resolveStorePath(tempDir), { recursive: true });
    expect(storeExists(tempDir)).toBe(true);
  });

  it('returns false when path is a file', () => {
    const storePath = resolveStorePath(tempDir);
    mkdirSync(join(tempDir, 'fiber'), { recursive: true });
    writeFileSync(storePath, 'not-a-dir');
    expect(storeExists(tempDir)).toBe(false);
  });
});
