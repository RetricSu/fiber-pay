/**
 * Implementation of `fiber-pay node upgrade`.
 */

import { dirname } from 'node:path';
import { BinaryManager, type DownloadProgress, MigrationManager } from '@fiber-pay/node';
import type { ResolvedBinaryPath } from './binary-path.js';
import { getBinaryManagerInstallDirOrThrow, resolveBinaryPath } from './binary-path.js';
import type { CliConfig } from './config.js';
import { loadProfileConfig, saveProfileConfig } from './config.js';
import { printJsonError, printJsonSuccess } from './format.js';
import { normalizeMigrationCheck, replaceRawMigrateHint } from './migration-utils.js';
import { getCustomBinaryState } from './node-runtime-daemon.js';
import { isProcessRunning, readPidFile } from './pid.js';

export interface NodeUpgradeOptions {
  version?: string;
  backup?: boolean;
  checkOnly?: boolean;
  forceMigrate?: boolean;
  json?: boolean;
}

export type NodeUpgradeMode = 'managed-download' | 'custom-migrate-only';

export function getNodeUpgradeMode(resolvedBinary: ResolvedBinaryPath): NodeUpgradeMode {
  return resolvedBinary.source === 'profile-managed' ? 'managed-download' : 'custom-migrate-only';
}

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

function stripVersionPrefix(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

export async function runNodeUpgradeCommand(
  config: CliConfig,
  options: NodeUpgradeOptions,
): Promise<void> {
  const json = Boolean(options.json);
  const resolvedBinary = resolveBinaryPath(config);
  const mode = getNodeUpgradeMode(resolvedBinary);

  // Pre-flight: node must be stopped before upgrade
  const pid = readPidFile(config.dataDir);
  if (pid && isProcessRunning(pid)) {
    const msg = 'The Fiber node is currently running. Stop it before upgrading.';
    if (json) {
      printJsonError({
        code: 'NODE_RUNNING',
        message: msg,
        recoverable: true,
        suggestion: 'Run `fiber-pay node stop` first, then retry the upgrade.',
      });
    } else {
      console.error(`❌ ${msg}`);
      console.log('   Run: fiber-pay node stop');
    }
    process.exit(1);
  }

  // Prepare migration-related paths
  const storePath = MigrationManager.resolveStorePath(config.dataDir);
  let migrateBinaryPath: string;
  try {
    migrateBinaryPath = getMigrateBinaryPathForBinary(resolvedBinary.binaryPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      printJsonError({
        code: 'BINARY_PATH_INCOMPATIBLE',
        message,
        recoverable: true,
        suggestion:
          'Set binaryPath to an explicit file path (absolute or relative), or unset binaryPath to use profile-managed binaries.',
      });
    } else {
      console.error(`❌ ${message}`);
      console.log(
        '   Set binaryPath to an explicit file path (absolute or relative), or unset binaryPath to use profile-managed binaries.',
      );
    }
    process.exit(1);
  }
  let migrationCheck: Awaited<ReturnType<MigrationManager['check']>> | null = null;

  const storeExists = MigrationManager.storeExists(config.dataDir);

  if (mode === 'custom-migrate-only') {
    const currentInfo = getCustomBinaryState(resolvedBinary.binaryPath);
    const customBinaryManager = new BinaryManager(dirname(resolvedBinary.binaryPath));
    const targetTag = options.version
      ? customBinaryManager.normalizeTag(options.version)
      : undefined;
    const targetVersion = targetTag ? stripVersionPrefix(targetTag) : undefined;

    if (!json) {
      console.log('🧭 Upgrade mode: custom binary (migration-only).');
      console.log(`🧩 Binary: ${resolvedBinary.binaryPath}`);
      if (currentInfo.ready) {
        console.log(`🧩 Current version: ${currentInfo.version}`);
      }
      if (targetTag) {
        console.log(
          `📦 Target version requested: ${targetTag} (download skipped for custom binary)`,
        );
      }
    }

    if (storeExists) {
      migrationCheck = await runMigrationAndReport({
        migrateBinaryPath,
        storePath,
        json,
        checkOnly: Boolean(options.checkOnly),
        targetVersion: targetVersion ?? currentInfo.version,
        backup: options.backup !== false,
        forceMigrateAttempt: Boolean(options.forceMigrate),
        mode,
        binaryPath: resolvedBinary.binaryPath,
      });
    } else if (!json) {
      console.log('📂 No existing store detected; migration check skipped.');
    }

    if (json) {
      printJsonSuccess({
        action: 'migrate-only',
        mode,
        source: resolvedBinary.source,
        currentVersion: currentInfo.version,
        targetVersion: targetVersion ?? null,
        binaryPath: resolvedBinary.binaryPath,
        migrateBinaryPath,
        migration: migrationCheck,
      });
    } else {
      console.log('\n✅ Upgrade flow complete (custom binary mode).');
      console.log('   Binary download was skipped by design.');
      console.log('   Migration checks were performed when a store was found.');
    }

    return;
  }

  let installDir: string;
  try {
    installDir = getBinaryManagerInstallDirOrThrow(resolvedBinary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      printJsonError({
        code: 'BINARY_PATH_INCOMPATIBLE',
        message,
        recoverable: true,
        suggestion:
          'Use `fiber-pay config profile unset binaryPath` or set binaryPath to a standard fnn filename in the target directory.',
      });
    } else {
      console.error(`❌ ${message}`);
    }
    process.exit(1);
  }

  const binaryManager = new BinaryManager(installDir);

  // Resolve target version
  let targetTag: string;
  if (options.version) {
    targetTag = binaryManager.normalizeTag(options.version);
  } else {
    if (!json) console.log('🔍 Resolving latest Fiber release...');
    targetTag = await binaryManager.getLatestTag();
  }

  if (!json) console.log(`📦 Target version: ${targetTag}`);

  // Check current version
  const currentInfo = await binaryManager.getBinaryInfo();
  const targetVersion = stripVersionPrefix(targetTag);

  if (!json && storeExists) {
    console.log('📂 Existing store detected.');
  }

  if (currentInfo.ready && currentInfo.version === targetVersion && !options.forceMigrate) {
    if (storeExists) {
      migrationCheck = await runMigrationAndReport({
        migrateBinaryPath,
        storePath,
        json,
        checkOnly: Boolean(options.checkOnly),
        targetVersion,
        backup: options.backup !== false,
        forceMigrateAttempt: false,
        mode,
        binaryPath: resolvedBinary.binaryPath,
      });
    }

    const msg = migrationCheck
      ? `Already installed ${targetTag}. Store compatibility checked.`
      : `Already installed ${targetTag}. Use --force-migrate to run migration flow anyway.`;
    if (json) {
      printJsonSuccess({
        action: 'none',
        currentVersion: currentInfo.version,
        targetVersion,
        message: msg,
        migration: migrationCheck,
      });
    } else {
      console.log(`✅ ${msg}`);
    }
    return;
  }

  const versionMatches = currentInfo.ready && currentInfo.version === targetVersion;
  const shouldDownload = !versionMatches;

  if (!json && currentInfo.ready) {
    console.log(`   Current version: v${currentInfo.version}`);
  }

  if (shouldDownload) {
    if (!json && storeExists) {
      console.log('📂 Existing store detected, will check migration after download.');
    }

    // Download new binary (this also extracts fnn-migrate)
    if (!json) console.log('⬇️  Downloading new binary...');

    const showProgress = (progress: DownloadProgress) => {
      if (!json) {
        const percent = progress.percent !== undefined ? ` (${progress.percent}%)` : '';
        process.stdout.write(`\r   [${progress.phase}]${percent} ${progress.message}`.padEnd(80));
        if (progress.phase === 'installing') console.log();
      }
    };

    await binaryManager.download({
      version: targetTag,
      force: true,
      onProgress: showProgress,
    });
  } else if (!json && options.forceMigrate) {
    console.log('⏭️  Skipping binary download: target version is already installed.');
    console.log('🔁 --force-migrate enabled: attempting migration flow on existing binaries.');
  }

  // Check migration if store exists
  if (storeExists) {
    migrationCheck = await runMigrationAndReport({
      migrateBinaryPath,
      storePath,
      json,
      checkOnly: Boolean(options.checkOnly),
      targetVersion,
      backup: options.backup !== false,
      forceMigrateAttempt: Boolean(options.forceMigrate),
      mode,
      binaryPath: resolvedBinary.binaryPath,
    });
  }

  // Final status
  const newInfo = await binaryManager.getBinaryInfo();

  if (resolvedBinary.source === 'profile-managed') {
    const profile = loadProfileConfig(config.dataDir) || {};
    profile.fiberVersion = newInfo.version;
    saveProfileConfig(config.dataDir, profile);
  }

  if (json) {
    printJsonSuccess({
      action: 'upgraded',
      mode,
      previousVersion: currentInfo.ready ? currentInfo.version : null,
      currentVersion: newInfo.version,
      binaryPath: newInfo.path,
      migrateBinaryPath,
      migration: migrationCheck,
    });
  } else {
    console.log('\n✅ Upgrade complete!');
    console.log(`   Version: v${newInfo.version}`);
    console.log(`   Binary:  ${newInfo.path}`);
    console.log('\n   Start the node with: fiber-pay node start');
  }
}

// =============================================================================
// Internal helpers
// =============================================================================

interface MigrationRunOptions {
  migrateBinaryPath: string;
  storePath: string;
  json: boolean;
  checkOnly: boolean;
  targetVersion: string;
  backup: boolean;
  forceMigrateAttempt: boolean;
  mode: NodeUpgradeMode;
  binaryPath: string;
}

/**
 * Run migration check (and optionally migrate) after a new binary has been
 * downloaded. Exits the process on unrecoverable errors.
 *
 * @returns The migration check result, or `null` if the caller should return
 *          early (e.g. `--check-only`).
 */
async function runMigrationAndReport(
  opts: MigrationRunOptions,
): Promise<Awaited<ReturnType<MigrationManager['check']>> | null> {
  const {
    migrateBinaryPath,
    storePath,
    json,
    checkOnly,
    targetVersion,
    backup,
    forceMigrateAttempt,
    mode,
    binaryPath,
  } = opts;

  const migrationManager = new MigrationManager(migrateBinaryPath);

  // Run check
  if (!json) console.log('🔍 Checking store compatibility...');

  let migrationCheck: Awaited<ReturnType<MigrationManager['check']>>;
  try {
    migrationCheck = await migrationManager.check(storePath);
  } catch (checkErr) {
    const msg = checkErr instanceof Error ? checkErr.message : String(checkErr);
    if (json) {
      printJsonError({
        code: 'MIGRATION_TOOL_MISSING',
        message: `Migration check failed: ${msg}`,
        recoverable: true,
        suggestion:
          mode === 'custom-migrate-only'
            ? `Verify fnn-migrate exists next to configured binary in "${dirname(binaryPath)}", then retry.`
            : 'Run `fiber-pay node upgrade` to reinstall binaries, then retry `fiber-pay node upgrade --force-migrate`.',
      });
    } else {
      console.error(`\n⚠️  Migration check failed: ${msg}`);
      if (mode === 'custom-migrate-only') {
        console.log(
          `   Verify fnn-migrate exists next to configured binary in "${dirname(binaryPath)}", then retry.`,
        );
      } else {
        console.log(
          '   Run `fiber-pay node upgrade` to reinstall binaries, then retry `fiber-pay node upgrade --force-migrate`.',
        );
      }
    }
    process.exit(1);
  }

  // --check-only: report and let the caller return
  if (checkOnly) {
    const normalizedCheck = normalizeMigrationCheck(migrationCheck);
    if (json) {
      printJsonSuccess({
        action: 'check-only',
        targetVersion,
        migration: normalizedCheck,
      });
    } else {
      console.log(`\n📋 Migration status: ${normalizedCheck.message}`);
    }
    // Signal to caller to return early
    process.exit(0);
  }

  const precheckUnsupported = migrationCheck.precheckUnsupported;

  if (precheckUnsupported && forceMigrateAttempt && !json) {
    console.log('⚠️  Migration pre-check is unavailable for this fnn-migrate version.');
    console.log('   --force-migrate is set, so migration will be attempted directly.');
  }

  if (!migrationCheck.needed && !(precheckUnsupported && forceMigrateAttempt)) {
    if (!json) console.log('   Store is compatible, no migration needed.');
    return normalizeMigrationCheck(migrationCheck);
  }

  // Breaking change — cannot auto-migrate
  if (!migrationCheck.valid && !forceMigrateAttempt) {
    const normalizedMessage = replaceRawMigrateHint(migrationCheck.message);
    if (json) {
      printJsonError({
        code: 'MIGRATION_INCOMPATIBLE',
        message: normalizedMessage,
        recoverable: false,
        suggestion: `Back up your store first (directory: "${storePath}"). Then run \`fiber-pay node upgrade --force-migrate\`. If it still fails, close all channels with the old fnn version, remove the store, and restart with a fresh store. If you attempted migration with backup enabled, you can roll back by restoring the backup directory.`,
        details: {
          storePath,
          migrationCheck: {
            ...migrationCheck,
            message: normalizedMessage,
          },
        },
      });
    } else {
      console.error('\n❌ Store migration is not possible automatically.');
      console.log(normalizedMessage);
      console.log(`   1) Back up store directory: ${storePath}`);
      console.log('   2) Try: fiber-pay node upgrade --force-migrate');
      console.log(
        '   3) If it still fails, close channels on old fnn, remove store, then restart.',
      );
      console.log('   4) If migration created a backup, you can roll back by restoring it.');
    }
    process.exit(1);
  }

  if (!migrationCheck.valid && !json) {
    console.log('⚠️  Store check reported incompatibility, but --force-migrate is set.');
    console.log('   Attempting migration anyway with backup enabled (unless --no-backup).');
  }

  // Run migration
  if (!json) console.log('🔄 Running database migration...');

  const result = await migrationManager.migrate({
    storePath,
    backup,
    force: forceMigrateAttempt,
  });

  if (!result.success) {
    if (json) {
      printJsonError({
        code: 'MIGRATION_FAILED',
        message: result.message,
        recoverable: !!result.backupPath,
        suggestion: result.backupPath
          ? `To roll back, delete the current store at "${storePath}" and restore the backup from "${result.backupPath}".`
          : 'Re-download the previous version or start fresh.',
        details: { output: result.output, backupPath: result.backupPath },
      });
    } else {
      console.error('\n❌ Migration failed.');
      console.log(result.message);
    }
    process.exit(1);
  }

  if (!json) {
    console.log(`✅ ${result.message}`);
    if (result.backupPath) {
      console.log(`   Backup: ${result.backupPath}`);
    }
  }

  try {
    const postCheck = await migrationManager.check(storePath);
    return normalizeMigrationCheck(postCheck);
  } catch (err) {
    if (!json) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('⚠️  Post-migration check failed; final migration status may be stale.');
      console.error(`   ${message}`);
    }
    return normalizeMigrationCheck(migrationCheck);
  }
}
