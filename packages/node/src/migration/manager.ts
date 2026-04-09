/**
 * Migration Manager
 * Handles Fiber node database migration when upgrading between versions.
 *
 * Uses the `fnn-migrate` binary shipped in Fiber release archives to migrate
 * the on-disk store format so that it is compatible with a newer `fnn` binary.
 */

import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// =============================================================================
// Types
// =============================================================================

export interface MigrationCheckResult {
  /** Whether migration is needed */
  needed: boolean;
  /** Whether the store is valid (parseable) */
  valid: boolean;
  /** Whether this fnn-migrate version does not support pre-check mode */
  precheckUnsupported: boolean;
  /** Human-readable status message */
  message: string;
  /** Path to the store that was checked */
  storePath: string;
}

export interface MigrationResult {
  /** Whether migration succeeded */
  success: boolean;
  /** Path to backup directory (if created) */
  backupPath?: string;
  /** Human-readable message */
  message: string;
  /** Detailed output from fnn-migrate */
  output?: string;
}

export interface MigrationOptions {
  /** Path to the fiber store directory (typically `<dataDir>/fiber/store`) */
  storePath: string;
  /** Create a backup before migrating (default: true) */
  backup?: boolean;
  /** Directory to place backups in (default: sibling of storePath) */
  backupDir?: string;
  /**
   * Force migration attempt even when pre-check reports incompatible data.
   * Use carefully: migration command may still fail and store may require
   * manual recovery; backup is strongly recommended.
   */
  force?: boolean;
}

// =============================================================================
// Migration Manager
// =============================================================================

export class MigrationManager {
  private migrateBinaryPath: string;
  private helpTextCache: string | null = null;

  constructor(migrateBinaryPath: string) {
    this.migrateBinaryPath = migrateBinaryPath;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Check whether the store needs migration or is incompatible.
   *
   * Runs `fnn-migrate` compatibility check when supported by the installed
   * migrate helper.
   */
  async check(storePath: string): Promise<MigrationCheckResult> {
    this.ensureBinaryExists();

    if (!existsSync(storePath)) {
      return {
        needed: false,
        valid: true,
        precheckUnsupported: false,
        message: 'Store does not exist yet — no migration needed.',
        storePath,
      };
    }

    const helpText = await this.getHelpText();
    const supportsCheckValidate = helpText.includes('--check-validate');

    // Newer fnn-migrate (v0.8.x) removed check mode; in that case we skip
    // compatibility pre-check instead of hard-failing startup/upgrade.
    if (!supportsCheckValidate) {
      return {
        needed: false,
        valid: true,
        precheckUnsupported: true,
        message:
          'Store pre-check is not supported by this fnn-migrate version; skipping compatibility check.',
        storePath,
      };
    }

    try {
      const { stdout, stderr } = await this.execWithStoreTargetArgs(storePath, [
        '--check-validate',
      ]);
      const output = `${stdout}\n${stderr}`.trim();
      if (output.includes('validate success')) {
        return {
          needed: false,
          valid: true,
          precheckUnsupported: false,
          message: 'Store is up-to-date, no migration needed.',
          storePath,
        };
      }
      return {
        needed: false,
        valid: true,
        precheckUnsupported: false,
        message: output || 'Store validation passed.',
        storePath,
      };
    } catch (error) {
      const stderr = this.extractStderr(error);
      const isIncompatible =
        stderr.includes('incompatible database') || stderr.includes('need to upgrade');
      const needsMigration =
        stderr.includes('need to run database migration') || stderr.includes('need to migrate');
      const needsCleanStart =
        stderr.includes('shutdown all channels') || stderr.includes('shutdown all old channels');

      if (needsCleanStart) {
        return {
          needed: true,
          valid: false,
          precheckUnsupported: false,
          message:
            'Store requires a breaking migration that cannot be auto-migrated. ' +
            'You need to:\n' +
            '  1. Start the OLD version of fnn\n' +
            '  2. Close all channels (cooperative or forced)\n' +
            '  3. Stop the old node\n' +
            '  4. Remove the store directory\n' +
            '  5. Start the new fnn version with a fresh database\n\n' +
            'See: https://github.com/nervosnetwork/fiber/wiki/Fiber-Breaking-Change-Migration-Guide',
          storePath,
        };
      }

      if (needsMigration) {
        return {
          needed: true,
          valid: true,
          precheckUnsupported: false,
          message: 'Store needs migration. Run `fiber-pay node upgrade` to migrate.',
          storePath,
        };
      }

      if (isIncompatible) {
        return {
          needed: true,
          valid: false,
          precheckUnsupported: false,
          message: `Store is incompatible: ${stderr}`,
          storePath,
        };
      }

      return {
        needed: true,
        valid: false,
        precheckUnsupported: false,
        message: `Store validation failed: ${stderr}`,
        storePath,
      };
    }
  }

  /**
   * Create a timestamped backup of the store directory.
   *
   * @returns The path to the created backup directory.
   */
  backup(storePath: string, backupDir?: string): string {
    if (!existsSync(storePath)) {
      throw new Error(`Store path does not exist: ${storePath}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const storeName = basename(storePath);
    const targetDir = backupDir || dirname(storePath);
    const backupPath = join(targetDir, `${storeName}.bak-${timestamp}`);

    mkdirSync(backupPath, { recursive: true });
    cpSync(storePath, backupPath, { recursive: true });

    return backupPath;
  }

  /**
   * Run the database migration.
   *
   * Optionally creates a backup first. Uses `--skip-confirm` to avoid
   * interactive prompts.
   */
  async migrate(options: MigrationOptions): Promise<MigrationResult> {
    const { storePath, backup: doBackup = true, backupDir, force = false } = options;

    this.ensureBinaryExists();

    if (!existsSync(storePath)) {
      return {
        success: true,
        message: 'Store does not exist — nothing to migrate.',
      };
    }

    // Pre-flight check
    const checkResult = await this.check(storePath);
    const precheckUnsupported = checkResult.precheckUnsupported;

    if (!checkResult.needed && !(force && precheckUnsupported)) {
      return {
        success: true,
        message: checkResult.message,
      };
    }

    if (!checkResult.valid && !force) {
      return {
        success: false,
        message: checkResult.message,
      };
    }

    // Backup
    let backupPath: string | undefined;
    if (doBackup) {
      try {
        backupPath = this.backup(storePath, backupDir);
      } catch (backupError) {
        const msg = backupError instanceof Error ? backupError.message : String(backupError);
        return {
          success: false,
          message: `Failed to create backup before migration: ${msg}`,
        };
      }
    }

    // Run migration
    try {
      const { stdout, stderr } = await this.execMigrateCommand(storePath);
      const output = `${stdout}\n${stderr}`.trim();

      if (output.includes('migrated successfully') || output.includes('db migrated')) {
        return {
          success: true,
          backupPath,
          message: 'Migration completed successfully.',
          output,
        };
      }

      if (output.toLowerCase().includes('no need to migrate')) {
        return {
          success: true,
          backupPath,
          message: 'Store is already up-to-date; no migration needed.',
          output,
        };
      }

      // Command exited 0 but no recognized success message — treat as failure to be safe
      let ambiguousMessage = `Migration command finished without errors, but the expected success message was not found. Output: ${output}`;
      if (backupPath) {
        ambiguousMessage += `\n\nA backup was created at: ${backupPath}\nTo roll back, delete the current store at "${storePath}" and restore the backup from that path.`;
      }
      return {
        success: false,
        backupPath,
        message: ambiguousMessage,
        output,
      };
    } catch (error) {
      const stderr = this.extractStderr(error);

      // Offer rollback information
      let message = `Migration failed: ${stderr}`;
      if (backupPath) {
        message += `\n\nA backup was created at: ${backupPath}\nTo roll back, delete the current store at "${storePath}" and restore the backup from that path.`;
      }

      return {
        success: false,
        backupPath,
        message,
        output: stderr,
      };
    }
  }

  /**
   * Rollback a migration by restoring a backup.
   */
  rollback(storePath: string, backupPath: string): void {
    if (!existsSync(backupPath)) {
      throw new Error(`Backup path does not exist: ${backupPath}`);
    }

    // Remove the (potentially corrupted) current store
    if (existsSync(storePath)) {
      rmSync(storePath, { recursive: true, force: true });
    }

    // Restore from backup
    renameSync(backupPath, storePath);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve the store path from a data directory.
   *
   * The fiber node stores its database at `<dataDir>/fiber/store`.
   */
  static resolveStorePath(dataDir: string): string {
    return join(dataDir, 'fiber', 'store');
  }

  /**
   * Check if the store directory exists and is a directory.
   */
  static storeExists(dataDir: string): boolean {
    const storePath = MigrationManager.resolveStorePath(dataDir);
    if (!existsSync(storePath)) return false;
    try {
      const stats = statSync(storePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  private ensureBinaryExists(): void {
    if (!existsSync(this.migrateBinaryPath)) {
      throw new Error(
        `fnn-migrate binary not found at: ${this.migrateBinaryPath}\n` +
          'This binary is required for database migration.\n' +
          'Re-download the Fiber binary with: fiber-pay binary download --force',
      );
    }
  }

  private async getHelpText(): Promise<string> {
    if (this.helpTextCache !== null) {
      return this.helpTextCache;
    }

    try {
      const { stdout, stderr } = await execFileAsync(this.migrateBinaryPath, ['--help']);
      this.helpTextCache = `${stdout}\n${stderr}`;
      return this.helpTextCache;
    } catch (error) {
      // If help invocation itself fails, treat as unknown capability and rely on
      // argument-shape fallback at execution time.
      this.helpTextCache = this.extractStderr(error);
      return this.helpTextCache;
    }
  }

  private async resolveTargetArgCandidates(storePath: string): Promise<string[][]> {
    const helpText = await this.getHelpText();
    const fiberDataDir = dirname(storePath);
    const prefersDirArg = helpText.includes('--dir');

    if (prefersDirArg) {
      return [
        ['--dir', fiberDataDir],
        ['-p', storePath],
      ];
    }

    return [
      ['-p', storePath],
      ['--dir', fiberDataDir],
    ];
  }

  private isArgShapeError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('unexpected argument') ||
      lower.includes('found argument') ||
      lower.includes('unknown option') ||
      lower.includes('invalid option') ||
      lower.includes('usage: fnn-migrate')
    );
  }

  private async execWithStoreTargetArgs(
    storePath: string,
    extraArgs: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    const candidates = await this.resolveTargetArgCandidates(storePath);
    let lastError: unknown = new Error('No valid fnn-migrate target argument style found.');

    for (const targetArgs of candidates) {
      try {
        return await execFileAsync(this.migrateBinaryPath, [...targetArgs, ...extraArgs]);
      } catch (error) {
        const msg = this.extractStderr(error);
        if (this.isArgShapeError(msg)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  private async execMigrateCommand(storePath: string): Promise<{ stdout: string; stderr: string }> {
    try {
      return await this.execWithStoreTargetArgs(storePath, ['--skip-confirm']);
    } catch (error) {
      const msg = this.extractStderr(error);
      if (!this.isArgShapeError(msg) || !msg.includes('--skip-confirm')) {
        throw error;
      }
    }

    return this.execWithStoreTargetArgs(storePath, ['-s']);
  }

  private extractStderr(error: unknown): string {
    if (error && typeof error === 'object') {
      const e = error as { stderr?: string; stdout?: string; message?: string };
      return (e.stderr || e.stdout || e.message || String(error)).trim();
    }
    return String(error);
  }
}
