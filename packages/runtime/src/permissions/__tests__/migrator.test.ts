import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, PermissionMigrator } from '../migrator.js';

describe('PermissionMigrator', () => {
  let tempDir: string;
  let dbPath: string;
  let migrationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'migrator-test-'));
    dbPath = join(tempDir, 'test.db');
    migrationsDir = join(tempDir, 'migrations');
    mkdirSync(migrationsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create migrator with db path', () => {
      const migrator = new PermissionMigrator(dbPath);

      expect(migrator).toBeDefined();
      migrator.close();
    });

    it('should create migrator with custom migrations directory', () => {
      const migrator = new PermissionMigrator(dbPath, migrationsDir);

      expect(migrator).toBeDefined();
      migrator.close();
    });

    it('should create database file', () => {
      const migrator = new PermissionMigrator(dbPath);
      migrator.close();

      // Check that database was created
      const db = new Database(dbPath);
      expect(db).toBeDefined();
      db.close();
    });

    it('should enable WAL mode', () => {
      const migrator = new PermissionMigrator(dbPath);
      migrator.close();

      const db = new Database(dbPath);
      const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(result.journal_mode).toBe('wal');
      db.close();
    });

    it('should enable foreign keys', () => {
      const migrator = new PermissionMigrator(dbPath);
      migrator.close();

      const db = new Database(dbPath);
      const result = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(result.foreign_keys).toBe(1);
      db.close();
    });
  });

  describe('ensureMigrationsTable', () => {
    it('should create __migrations table', () => {
      const migrator = new PermissionMigrator(dbPath);
      migrator.ensureMigrationsTable();
      migrator.close();

      const db = new Database(dbPath);
      const result = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__migrations'")
        .get();
      expect(result).toBeDefined();
      db.close();
    });

    it('should create table with correct schema', () => {
      const migrator = new PermissionMigrator(dbPath);
      migrator.ensureMigrationsTable();
      migrator.close();

      const db = new Database(dbPath);
      const columns = db.prepare('PRAGMA table_info(__migrations)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
      }>;

      const versionCol = columns.find((c) => c.name === 'version');
      const appliedAtCol = columns.find((c) => c.name === 'applied_at');
      const nameCol = columns.find((c) => c.name === 'name');

      expect(versionCol).toBeDefined();
      expect(versionCol?.type).toBe('INTEGER');
      expect(appliedAtCol).toBeDefined();
      expect(appliedAtCol?.type).toBe('INTEGER');
      expect(appliedAtCol?.notnull).toBe(1);
      expect(nameCol).toBeDefined();
      expect(nameCol?.type).toBe('TEXT');
      expect(nameCol?.notnull).toBe(1);

      db.close();
    });
  });

  describe('getAppliedMigrations', () => {
    it('should return empty array when no migrations applied', () => {
      const migrator = new PermissionMigrator(dbPath);

      const applied = migrator.getAppliedMigrations();

      expect(applied).toEqual([]);
      migrator.close();
    });

    it('should return applied migration versions', () => {
      const migrator = new PermissionMigrator(dbPath);
      migrator.ensureMigrationsTable();

      const db = new Database(dbPath);
      db.prepare('INSERT INTO __migrations (version, applied_at, name) VALUES (?, ?, ?)').run(
        1,
        Date.now(),
        '001_initial',
      );
      db.prepare('INSERT INTO __migrations (version, applied_at, name) VALUES (?, ?, ?)').run(
        2,
        Date.now(),
        '002_add_index',
      );
      db.close();

      const applied = migrator.getAppliedMigrations();

      expect(applied).toEqual([1, 2]);
      migrator.close();
    });

    it('should return versions in ascending order', () => {
      const migrator = new PermissionMigrator(dbPath);
      migrator.ensureMigrationsTable();

      const db = new Database(dbPath);
      // Insert out of order
      db.prepare('INSERT INTO __migrations (version, applied_at, name) VALUES (?, ?, ?)').run(
        3,
        Date.now(),
        '003_third',
      );
      db.prepare('INSERT INTO __migrations (version, applied_at, name) VALUES (?, ?, ?)').run(
        1,
        Date.now(),
        '001_first',
      );
      db.prepare('INSERT INTO __migrations (version, applied_at, name) VALUES (?, ?, ?)').run(
        2,
        Date.now(),
        '002_second',
      );
      db.close();

      const applied = migrator.getAppliedMigrations();

      expect(applied).toEqual([1, 2, 3]);
      migrator.close();
    });
  });

  describe('getPendingMigrations', () => {
    it('should return all migrations when none applied', () => {
      writeFileSync(join(migrationsDir, '001_initial.sql'), 'CREATE TABLE test1 (id INTEGER);');
      writeFileSync(join(migrationsDir, '002_add_table.sql'), 'CREATE TABLE test2 (id INTEGER);');

      const migrator = new PermissionMigrator(dbPath, migrationsDir);

      const pending = migrator.getPendingMigrations();

      expect(pending).toHaveLength(2);
      expect(pending[0].version).toBe(1);
      expect(pending[1].version).toBe(2);
      migrator.close();
    });

    it('should return only unapplied migrations', () => {
      writeFileSync(join(migrationsDir, '001_initial.sql'), 'CREATE TABLE test1 (id INTEGER);');
      writeFileSync(join(migrationsDir, '002_add_table.sql'), 'CREATE TABLE test2 (id INTEGER);');
      writeFileSync(
        join(migrationsDir, '003_add_index.sql'),
        'CREATE INDEX idx_test ON test1(id);',
      );

      const migrator = new PermissionMigrator(dbPath, migrationsDir);
      migrator.ensureMigrationsTable();

      // Mark first two as applied
      const db = new Database(dbPath);
      db.prepare('INSERT INTO __migrations (version, applied_at, name) VALUES (?, ?, ?)').run(
        1,
        Date.now(),
        '001_initial',
      );
      db.prepare('INSERT INTO __migrations (version, applied_at, name) VALUES (?, ?, ?)').run(
        2,
        Date.now(),
        '002_add_table',
      );
      db.close();

      const pending = migrator.getPendingMigrations();

      expect(pending).toHaveLength(1);
      expect(pending[0].version).toBe(3);
      migrator.close();
    });

    it('should return empty array when all migrations applied', () => {
      writeFileSync(join(migrationsDir, '001_initial.sql'), 'CREATE TABLE test1 (id INTEGER);');

      const migrator = new PermissionMigrator(dbPath, migrationsDir);
      migrator.ensureMigrationsTable();

      const db = new Database(dbPath);
      db.prepare('INSERT INTO __migrations (version, applied_at, name) VALUES (?, ?, ?)').run(
        1,
        Date.now(),
        '001_initial',
      );
      db.close();

      const pending = migrator.getPendingMigrations();

      expect(pending).toEqual([]);
      migrator.close();
    });

    it('should ignore non-sql files', () => {
      writeFileSync(join(migrationsDir, '001_initial.sql'), 'CREATE TABLE test1 (id INTEGER);');
      writeFileSync(join(migrationsDir, 'README.md'), '# Migrations');
      writeFileSync(join(migrationsDir, '002_add_table.txt'), 'Not SQL');

      const migrator = new PermissionMigrator(dbPath, migrationsDir);

      const pending = migrator.getPendingMigrations();

      expect(pending).toHaveLength(1);
      expect(pending[0].version).toBe(1);
      migrator.close();
    });

    it('should ignore files not matching migration pattern', () => {
      writeFileSync(join(migrationsDir, '001_initial.sql'), 'CREATE TABLE test1 (id INTEGER);');
      writeFileSync(join(migrationsDir, 'initial.sql'), 'CREATE TABLE test2 (id INTEGER);');
      writeFileSync(
        join(migrationsDir, '99_no_leading_zeros.sql'),
        'CREATE TABLE test3 (id INTEGER);',
      );

      const migrator = new PermissionMigrator(dbPath, migrationsDir);

      const pending = migrator.getPendingMigrations();

      expect(pending).toHaveLength(1);
      expect(pending[0].version).toBe(1);
      migrator.close();
    });
  });

  describe('migrate', () => {
    it('should run pending migrations', async () => {
      writeFileSync(
        join(migrationsDir, '001_initial.sql'),
        'CREATE TABLE test_table (id INTEGER PRIMARY KEY);',
      );

      const migrator = new PermissionMigrator(dbPath, migrationsDir);
      await migrator.migrate();

      const db = new Database(dbPath);
      const result = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'")
        .get();
      expect(result).toBeDefined();
      db.close();
      migrator.close();
    });

    it('should record applied migrations', async () => {
      writeFileSync(join(migrationsDir, '001_initial.sql'), 'CREATE TABLE test1 (id INTEGER);');

      const migrator = new PermissionMigrator(dbPath, migrationsDir);
      await migrator.migrate();

      const applied = migrator.getAppliedMigrations();
      expect(applied).toContain(1);
      migrator.close();
    });

    it('should run multiple migrations in order', async () => {
      writeFileSync(join(migrationsDir, '001_first.sql'), 'CREATE TABLE table1 (id INTEGER);');
      writeFileSync(join(migrationsDir, '002_second.sql'), 'CREATE TABLE table2 (id INTEGER);');
      writeFileSync(join(migrationsDir, '003_third.sql'), 'CREATE TABLE table3 (id INTEGER);');

      const migrator = new PermissionMigrator(dbPath, migrationsDir);
      await migrator.migrate();

      const db = new Database(dbPath);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'table%'")
        .all() as Array<{ name: string }>;

      expect(tables).toHaveLength(3);
      db.close();
      migrator.close();
    });

    it('should not re-run already applied migrations', async () => {
      writeFileSync(
        join(migrationsDir, '001_initial.sql'),
        'CREATE TABLE test_table (id INTEGER);',
      );

      const migrator = new PermissionMigrator(dbPath, migrationsDir);

      // First run
      await migrator.migrate();

      // Second run should be no-op
      await migrator.migrate();

      const applied = migrator.getAppliedMigrations();
      expect(applied.filter((v) => v === 1)).toHaveLength(1);
      migrator.close();
    });

    it('should run only new migrations on subsequent runs', async () => {
      writeFileSync(join(migrationsDir, '001_first.sql'), 'CREATE TABLE table1 (id INTEGER);');

      const migrator = new PermissionMigrator(dbPath, migrationsDir);
      await migrator.migrate();

      // Add new migration
      writeFileSync(join(migrationsDir, '002_second.sql'), 'CREATE TABLE table2 (id INTEGER);');

      await migrator.migrate();

      const db = new Database(dbPath);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'table%'")
        .all() as Array<{ name: string }>;

      expect(tables).toHaveLength(2);
      db.close();
      migrator.close();
    });

    it('should run migrations in transaction', async () => {
      // This migration has a syntax error at the end
      writeFileSync(
        join(migrationsDir, '001_broken.sql'),
        `
        CREATE TABLE test_table (id INTEGER);
        INVALID SQL STATEMENT;
      `,
      );

      const migrator = new PermissionMigrator(dbPath, migrationsDir);

      try {
        await migrator.migrate();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        // Expected to fail
        expect(error).toBeDefined();
      }

      // Verify the table was not created (transaction rolled back)
      const db = new Database(dbPath);
      const result = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'")
        .get();
      expect(result).toBeUndefined();
      db.close();
      migrator.close();
    });

    it('should throw error with migration details on failure', async () => {
      writeFileSync(join(migrationsDir, '002_bad_migration.sql'), 'INVALID SYNTAX');

      const migrator = new PermissionMigrator(dbPath, migrationsDir);

      try {
        await migrator.migrate();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Migration 2');
        expect((error as Error).message).toContain('002_bad_migration');
      }

      migrator.close();
    });

    it('should do nothing when no pending migrations', async () => {
      const migrator = new PermissionMigrator(dbPath, migrationsDir);

      await migrator.migrate();

      expect(migrator.getAppliedMigrations()).toEqual([]);
      migrator.close();
    });

    it('should handle migrations with multiple statements', async () => {
      writeFileSync(
        join(migrationsDir, '001_complex.sql'),
        `
        CREATE TABLE table1 (id INTEGER PRIMARY KEY);
        CREATE TABLE table2 (id INTEGER PRIMARY KEY);
        CREATE INDEX idx_table1 ON table1(id);
        INSERT INTO table1 (id) VALUES (1);
        INSERT INTO table1 (id) VALUES (2);
      `,
      );

      const migrator = new PermissionMigrator(dbPath, migrationsDir);
      await migrator.migrate();

      const db = new Database(dbPath);
      const count = db.prepare('SELECT COUNT(*) as count FROM table1').get() as { count: number };
      expect(count.count).toBe(2);
      db.close();
      migrator.close();
    });
  });

  describe('close', () => {
    it('should close database connection', () => {
      const migrator = new PermissionMigrator(dbPath);
      migrator.close();

      // Should be able to create new connection to same file
      const db = new Database(dbPath);
      expect(db).toBeDefined();
      db.close();
    });
  });

  describe('Edge Cases', () => {
    it('should handle migration file with comments', async () => {
      writeFileSync(
        join(migrationsDir, '001_with_comments.sql'),
        `
        -- This is a comment
        CREATE TABLE test_table (
          id INTEGER PRIMARY KEY -- inline comment
        );
        /* Multi-line
           comment */
      `,
      );

      const migrator = new PermissionMigrator(dbPath, migrationsDir);
      await migrator.migrate();

      const db = new Database(dbPath);
      const result = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'")
        .get();
      expect(result).toBeDefined();
      db.close();
      migrator.close();
    });

    it('should handle empty migration file', async () => {
      writeFileSync(join(migrationsDir, '001_empty.sql'), '');

      const migrator = new PermissionMigrator(dbPath, migrationsDir);

      // Should not throw
      await migrator.migrate();

      migrator.close();
    });

    it('should handle migration file with only whitespace', async () => {
      writeFileSync(join(migrationsDir, '001_whitespace.sql'), '   \n\n   \n');

      const migrator = new PermissionMigrator(dbPath, migrationsDir);

      // Should not throw
      await migrator.migrate();

      migrator.close();
    });

    it('should handle large version numbers', async () => {
      writeFileSync(join(migrationsDir, '999_large.sql'), 'CREATE TABLE large_test (id INTEGER);');

      const migrator = new PermissionMigrator(dbPath, migrationsDir);
      await migrator.migrate();

      const applied = migrator.getAppliedMigrations();
      expect(applied).toContain(999);
      migrator.close();
    });

    it('should handle migrations directory that does not exist', () => {
      const nonExistentDir = join(tempDir, 'non-existent-migrations');

      const migrator = new PermissionMigrator(dbPath, nonExistentDir);

      const pending = migrator.getPendingMigrations();
      expect(pending).toEqual([]);

      migrator.close();
    });

    it('should handle migration names with underscores and hyphens', async () => {
      writeFileSync(
        join(migrationsDir, '001_initial-schema.sql'),
        'CREATE TABLE test1 (id INTEGER);',
      );
      writeFileSync(
        join(migrationsDir, '002_add_user_table.sql'),
        'CREATE TABLE test2 (id INTEGER);',
      );

      const migrator = new PermissionMigrator(dbPath, migrationsDir);
      await migrator.migrate();

      const applied = migrator.getAppliedMigrations();
      expect(applied).toContain(1);
      expect(applied).toContain(2);
      migrator.close();
    });
  });
});

describe('migrate helper function', () => {
  let tempDir: string;
  let dbPath: string;
  let migrationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'migrate-helper-test-'));
    dbPath = join(tempDir, 'test.db');
    migrationsDir = join(tempDir, 'migrations');
    mkdirSync(migrationsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should run migrations and close connection', async () => {
    writeFileSync(join(migrationsDir, '001_initial.sql'), 'CREATE TABLE test (id INTEGER);');

    // Use the built-in migrations from the actual path for this test
    // We'll test with an empty directory to avoid needing the real migrations
    await migrate(dbPath);

    // Verify database was created and migrations ran
    const db = new Database(dbPath);
    const result = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__migrations'")
      .get();
    expect(result).toBeDefined();
    db.close();
  });

  it('should not throw when no migrations to run', async () => {
    // Should complete without error even with no migrations
    await migrate(dbPath);

    // Verify database was created
    const db = new Database(dbPath);
    expect(db).toBeDefined();
    db.close();
  });
});
