import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { BinaryManager } from '@fiber-pay/node';

export type NodeBinaryMode = 'managed-download' | 'custom-migrate-only';

interface MigrateBinaryErrorInfo {
  code: 'BINARY_PATH_INCOMPATIBLE' | 'MIGRATION_TOOL_MISSING';
  message: string;
  suggestion: string;
  recoverable: boolean;
}

export type UpgradeMigrateBinaryResolution =
  | {
      ok: true;
      migrateBinaryPath: string;
    }
  | {
      ok: false;
      error: MigrateBinaryErrorInfo;
    };

export function getMigrateBinaryPathForBinary(binaryPath: string): string {
  const binaryDir = dirname(binaryPath);
  if (binaryDir === '.' || binaryDir.length === 0) {
    throw new Error(
      `Configured binaryPath "${binaryPath}" must include an explicit directory path. ` +
        'Use an absolute path (for example /opt/fiber/fnn) or a relative path (for example ./fnn).',
    );
  }

  return new BinaryManager(binaryDir).getMigrateBinaryPath();
}

function getMissingMigrateSuggestion(mode: NodeBinaryMode, binaryPath: string): string {
  if (mode === 'custom-migrate-only') {
    return (
      `Place fnn-migrate next to configured binary in "${dirname(binaryPath)}", ` +
      'or unset binaryPath to switch back to profile-managed binaries.'
    );
  }

  return 'Run `fiber-pay node upgrade` to reinstall binaries, then retry `fiber-pay node upgrade --force-migrate`.';
}

export function resolveUpgradeMigrateBinary(
  binaryPath: string,
  mode: NodeBinaryMode,
  storeExists: boolean,
): UpgradeMigrateBinaryResolution {
  let migrateBinaryPath: string;

  try {
    migrateBinaryPath = getMigrateBinaryPathForBinary(binaryPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        code: 'BINARY_PATH_INCOMPATIBLE',
        message,
        recoverable: true,
        suggestion:
          'Set binaryPath to an explicit file path (absolute or relative), or unset binaryPath to use profile-managed binaries.',
      },
    };
  }

  if (storeExists && !existsSync(migrateBinaryPath)) {
    return {
      ok: false,
      error: {
        code: 'MIGRATION_TOOL_MISSING',
        message: `fnn-migrate binary not found at: ${migrateBinaryPath}`,
        recoverable: true,
        suggestion: getMissingMigrateSuggestion(mode, binaryPath),
      },
    };
  }

  return { ok: true, migrateBinaryPath };
}

export function resolveGuardMigrateBinary(
  binaryPath: string,
): { ok: true; migrateBinaryPath: string } | { ok: false; skippedReason: string } {
  try {
    const migrateBinaryPath = getMigrateBinaryPathForBinary(binaryPath);
    if (!existsSync(migrateBinaryPath)) {
      return { ok: false, skippedReason: 'fnn-migrate binary not available' };
    }
    return { ok: true, migrateBinaryPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, skippedReason: `migration guard skipped: ${message}` };
  }
}

export function getMissingMigrateVerifySuggestion(
  mode: NodeBinaryMode,
  binaryPath: string,
): string {
  if (mode === 'custom-migrate-only') {
    return `Verify fnn-migrate exists next to configured binary in "${dirname(binaryPath)}", then retry.`;
  }

  return 'Run `fiber-pay node upgrade` to reinstall binaries, then retry `fiber-pay node upgrade --force-migrate`.';
}
