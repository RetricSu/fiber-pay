/**
 * Legacy migration helper
 *
 * Downloads the fnn-migrate binary from an old Fiber release (v0.8.x) and runs
 * it against a store so that fnn v0.9.0-rc4+ can open it.
 */

import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { BinaryManager } from '../binary/manager.js';

const execFileAsync = promisify(execFile);

export interface LegacyMigrationOptions {
  storePath: string;
  backup?: boolean;
  backupDir?: string;
}

export interface LegacyMigrationResult {
  success: boolean;
  message: string;
  backupPath?: string;
  output?: string;
}

export class LegacyMigration {
  private binaryManager: BinaryManager;

  constructor(
    private legacyVersion: string = 'v0.8.1',
    installDir?: string,
  ) {
    const targetDir =
      installDir || join(tmpdir(), 'fiber-pay-legacy-migrate', legacyVersion, 'bin');
    this.binaryManager = new BinaryManager(targetDir);
  }

  /**
   * Run the legacy v0.8.x fnn-migrate against the store.
   * This is a no-op for stores already at the v0.9.0 epoch and migrates
   * older stores up to the threshold required by fnn v0.9.0-rc4.
   */
  async migrate(options: LegacyMigrationOptions): Promise<LegacyMigrationResult> {
    const { storePath, backup = true, backupDir } = options;

    if (!existsSync(storePath)) {
      return { success: true, message: 'Store does not exist; no legacy migration needed.' };
    }

    let backupPath: string | undefined;
    if (backup) {
      backupPath = this.backup(storePath, backupDir);
    }

    try {
      const migrateBinaryPath = await this.ensureMigrateBinary();
      const fiberDataDir = dirname(storePath);
      const { stdout, stderr } = await execFileAsync(migrateBinaryPath, [
        '-d',
        fiberDataDir,
        '--skip-confirm',
      ]);
      const output = `${stdout}\n${stderr}`.trim();
      return {
        success: true,
        message: 'Legacy migration completed (or store was already at the v0.9.0 threshold).',
        backupPath,
        output,
      };
    } catch (error) {
      const stderr = this.extractStderr(error);

      // The legacy binary reports this when the store is already newer than v0.8.x.
      if (stderr.includes('incompatible database, need to upgrade fiber binary')) {
        return {
          success: true,
          message: 'Store is already past the legacy migration threshold; skipping.',
          backupPath,
          output: stderr,
        };
      }

      return {
        success: false,
        message: `Legacy migration failed: ${stderr}`,
        backupPath,
        output: stderr,
      };
    }
  }

  private async ensureMigrateBinary(): Promise<string> {
    return this.binaryManager.downloadLegacyMigrateBinary(
      this.legacyVersion,
      dirname(this.binaryManager.getBinaryPath()),
    );
  }

  private backup(storePath: string, backupDir?: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targetDir = backupDir || dirname(storePath);
    const backupPath = join(targetDir, `store.bak-${timestamp}`);
    mkdirSync(backupPath, { recursive: true });
    cpSync(storePath, backupPath, { recursive: true });
    return backupPath;
  }

  private extractStderr(error: unknown): string {
    if (error && typeof error === 'object') {
      const e = error as { stderr?: string; stdout?: string; message?: string };
      return (e.stderr || e.stdout || e.message || String(error)).trim();
    }
    return String(error);
  }
}
