import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { MigrationManager } from '../src/migration/manager.js';

// =============================================================================
// Helpers
// =============================================================================

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `fiber-pay-test-${prefix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createFakeStore(baseDir: string): string {
  const storePath = join(baseDir, 'fiber', 'store');
  mkdirSync(storePath, { recursive: true });
  writeFileSync(join(storePath, 'data.db'), 'fake-db-content');
  return storePath;
}

function createFakeMigrateBinary(dir: string): string {
  const binPath = join(dir, 'fnn-migrate');
  // Simple script that echoes args — we won't actually exec it in most tests
  writeFileSync(binPath, '#!/bin/sh\necho "fake-fnn-migrate $@"');
  const { chmodSync } = require('node:fs');
  chmodSync(binPath, 0o755);
  return binPath;
}

// =============================================================================
// Tests
// =============================================================================

describe('MigrationManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('migration');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  describe('resolveStorePath', () => {
    it('appends fiber/store to dataDir', () => {
      const result = MigrationManager.resolveStorePath('/home/user/.fiber-pay');
      expect(result).toBe(join('/home/user/.fiber-pay', 'fiber', 'store'));
    });
  });

  describe('storeExists', () => {
    it('returns false when store directory does not exist', () => {
      expect(MigrationManager.storeExists(tempDir)).toBe(false);
    });

    it('returns true when store directory exists', () => {
      createFakeStore(tempDir);
      expect(MigrationManager.storeExists(tempDir)).toBe(true);
    });

    it('returns false when path is a file, not a directory', () => {
      const storePath = MigrationManager.resolveStorePath(tempDir);
      mkdirSync(join(tempDir, 'fiber'), { recursive: true });
      writeFileSync(storePath, 'not-a-dir');
      expect(MigrationManager.storeExists(tempDir)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Constructor / ensureBinaryExists
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('throws on check when binary does not exist', async () => {
      const mm = new MigrationManager('/nonexistent/fnn-migrate');
      await expect(mm.check('/some/store')).rejects.toThrow('fnn-migrate binary not found');
    });

    it('throws on migrate when binary does not exist', async () => {
      const storePath = createFakeStore(tempDir);
      const mm = new MigrationManager('/nonexistent/fnn-migrate');
      await expect(mm.migrate({ storePath })).rejects.toThrow('fnn-migrate binary not found');
    });
  });

  // ---------------------------------------------------------------------------
  // check() — store does not exist
  // ---------------------------------------------------------------------------

  describe('check()', () => {
    it('returns not-needed when store does not exist', async () => {
      const binPath = createFakeMigrateBinary(tempDir);
      const mm = new MigrationManager(binPath);
      const result = await mm.check(join(tempDir, 'nonexistent'));
      expect(result.needed).toBe(false);
      expect(result.valid).toBe(true);
      expect(result.message).toContain('does not exist');
    });
  });

  // ---------------------------------------------------------------------------
  // backup()
  // ---------------------------------------------------------------------------

  describe('backup()', () => {
    it('creates a timestamped backup of the store', () => {
      const storePath = createFakeStore(tempDir);
      const binPath = createFakeMigrateBinary(tempDir);
      const mm = new MigrationManager(binPath);

      const backupPath = mm.backup(storePath);

      expect(existsSync(backupPath)).toBe(true);
      expect(backupPath).toContain('store.bak-');
      // Verify content was copied
      const files = readdirSync(backupPath);
      expect(files).toContain('data.db');
      const content = readFileSync(join(backupPath, 'data.db'), 'utf-8');
      expect(content).toBe('fake-db-content');
    });

    it('accepts a custom backup directory', () => {
      const storePath = createFakeStore(tempDir);
      const backupDir = join(tempDir, 'custom-backups');
      mkdirSync(backupDir, { recursive: true });
      const binPath = createFakeMigrateBinary(tempDir);
      const mm = new MigrationManager(binPath);

      const backupPath = mm.backup(storePath, backupDir);

      expect(backupPath.startsWith(backupDir)).toBe(true);
      expect(existsSync(backupPath)).toBe(true);
    });

    it('throws when store path does not exist', () => {
      const binPath = createFakeMigrateBinary(tempDir);
      const mm = new MigrationManager(binPath);
      expect(() => mm.backup('/nonexistent/store')).toThrow('does not exist');
    });
  });

  // ---------------------------------------------------------------------------
  // rollback()
  // ---------------------------------------------------------------------------

  describe('rollback()', () => {
    it('restores backup by replacing store', () => {
      const storePath = createFakeStore(tempDir);
      const binPath = createFakeMigrateBinary(tempDir);
      const mm = new MigrationManager(binPath);

      // Create backup
      const backupPath = mm.backup(storePath);

      // Simulate migration damage — overwrite store content
      writeFileSync(join(storePath, 'data.db'), 'corrupted');

      // Rollback
      mm.rollback(storePath, backupPath);

      // Verify original content restored
      const content = readFileSync(join(storePath, 'data.db'), 'utf-8');
      expect(content).toBe('fake-db-content');
      // Backup should be gone (renamed into place)
      expect(existsSync(backupPath)).toBe(false);
    });

    it('works even if current store was deleted', () => {
      const storePath = createFakeStore(tempDir);
      const binPath = createFakeMigrateBinary(tempDir);
      const mm = new MigrationManager(binPath);

      const backupPath = mm.backup(storePath);
      rmSync(storePath, { recursive: true });

      mm.rollback(storePath, backupPath);

      expect(existsSync(storePath)).toBe(true);
      const content = readFileSync(join(storePath, 'data.db'), 'utf-8');
      expect(content).toBe('fake-db-content');
    });

    it('throws when backup path does not exist', () => {
      const binPath = createFakeMigrateBinary(tempDir);
      const mm = new MigrationManager(binPath);
      expect(() => mm.rollback('/store', '/nonexistent/backup')).toThrow('does not exist');
    });
  });

  // ---------------------------------------------------------------------------
  // migrate() — store does not exist
  // ---------------------------------------------------------------------------

  describe('migrate()', () => {
    it('returns success when store does not exist', async () => {
      const binPath = createFakeMigrateBinary(tempDir);
      const mm = new MigrationManager(binPath);
      const result = await mm.migrate({
        storePath: join(tempDir, 'nonexistent'),
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('nothing to migrate');
    });
  });
});
