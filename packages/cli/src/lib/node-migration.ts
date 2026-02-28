/**
 * Shared migration-guard logic used by both `node start` and `node upgrade`.
 */

import { dirname } from 'node:path';
import { BinaryManager, type MigrationCheckResult, MigrationManager } from '@fiber-pay/node';
import { printJsonError } from './format.js';

// =============================================================================
// Types
// =============================================================================

export interface MigrationGuardResult {
  /** Whether the guard ran (false when no store exists or fnn-migrate is missing) */
  checked: boolean;
  /** The migration check result (undefined when `checked` is false) */
  migrationCheck?: MigrationCheckResult;
  /** When the guard was skipped, explain why */
  skippedReason?: string;
}

export interface MigrationGuardOptions {
  /** Absolute data directory */
  dataDir: string;
  /**
   * Resolved binary path of `fnn`.
   * The migrate binary is looked up relative to the *directory* of this path,
   * so it works even when binaryPath is overridden via config.
   */
  binaryPath: string;
  /** Output machine-readable JSON instead of human-friendly text */
  json: boolean;
}

// =============================================================================
// Pre-start migration guard
// =============================================================================

/**
 * Check whether the on-disk store requires migration before starting fnn.
 *
 * - If migration is needed the function prints an error and calls
 *   `process.exit(1)`.
 * - If `fnn-migrate` is unavailable the check is silently skipped (the node
 *   itself will fail later with a clear error if the schema really is stale).
 * - Returns a result describing what happened so callers can emit structured
 *   events (e.g. startup stages).
 */
export async function runMigrationGuard(
  opts: MigrationGuardOptions,
): Promise<MigrationGuardResult> {
  const { dataDir, binaryPath, json } = opts;

  if (!MigrationManager.storeExists(dataDir)) {
    return { checked: false, skippedReason: 'store does not exist' };
  }

  const storePath = MigrationManager.resolveStorePath(dataDir);
  const binaryDir = dirname(binaryPath);
  const bm = new BinaryManager(binaryDir);
  const migrateBinPath = bm.getMigrateBinaryPath();

  let migrationCheck: MigrationCheckResult;
  try {
    const migrationManager = new MigrationManager(migrateBinPath);
    migrationCheck = await migrationManager.check(storePath);
  } catch {
    // fnn-migrate binary may not exist (e.g. older install). Skip silently.
    return { checked: false, skippedReason: 'fnn-migrate binary not available' };
  }

  if (migrationCheck.needed) {
    const message = migrationCheck.valid
      ? 'Database migration required. Run `fiber-pay node upgrade` before starting.'
      : migrationCheck.message;

    if (json) {
      printJsonError({
        code: 'MIGRATION_REQUIRED',
        message,
        recoverable: true,
        suggestion: 'Run `fiber-pay node upgrade` to migrate the database, then retry start.',
        details: { storePath, migrationCheck },
      });
    } else {
      console.error(`❌ ${message}`);
    }
    process.exit(1);
  }

  return { checked: true, migrationCheck };
}
