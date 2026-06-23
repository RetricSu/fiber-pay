import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { BinaryManager } from '../src/binary/manager.js';
import { LegacyMigration } from '../src/migration/legacy.js';

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `fiber-pay-test-${prefix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createFakeMigrateBinary(dir: string, exitCode = 0, stderr = ''): string {
  const binPath = join(dir, 'fnn-migrate');
  const stderrLine = stderr ? `echo "${stderr}" >&2` : '';
  writeFileSync(
    binPath,
    `#!/bin/sh\necho "fake-fnn-migrate $*" >&2\n${stderrLine}\nexit ${exitCode}`,
  );
  chmodSync(binPath, 0o755);
  return binPath;
}

describe('LegacyMigration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('legacy-migration');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns success when store does not exist', async () => {
    const legacy = new LegacyMigration('v0.8.1', join(tempDir, 'bin'));
    const result = await legacy.migrate({ storePath: join(tempDir, 'no-store') });
    expect(result.success).toBe(true);
    expect(result.message).toContain('does not exist');
  });

  it('backs up the store before migrating', async () => {
    const storePath = join(tempDir, 'fiber', 'store');
    mkdirSync(storePath, { recursive: true });
    writeFileSync(join(storePath, 'data.db'), 'fake');

    const migrateDir = join(tempDir, 'bin');
    mkdirSync(migrateDir, { recursive: true });
    const fakeBinaryPath = createFakeMigrateBinary(migrateDir);

    vi.spyOn(BinaryManager.prototype, 'downloadLegacyMigrateBinary').mockResolvedValue(
      fakeBinaryPath,
    );

    const legacy = new LegacyMigration('v0.8.1', migrateDir);
    const result = await legacy.migrate({ storePath });
    expect(result.success).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath!)).toBe(true);
  });

  it('treats "incompatible database" as already migrated', async () => {
    const storePath = join(tempDir, 'fiber', 'store');
    mkdirSync(storePath, { recursive: true });

    const migrateDir = join(tempDir, 'bin');
    mkdirSync(migrateDir, { recursive: true });
    const fakeBinaryPath = createFakeMigrateBinary(
      migrateDir,
      1,
      'incompatible database, need to upgrade fiber binary',
    );

    vi.spyOn(BinaryManager.prototype, 'downloadLegacyMigrateBinary').mockResolvedValue(
      fakeBinaryPath,
    );

    const legacy = new LegacyMigration('v0.8.1', migrateDir);
    const result = await legacy.migrate({ storePath, backup: false });
    expect(result.success).toBe(true);
    expect(result.message).toContain('already past');
  });
});
