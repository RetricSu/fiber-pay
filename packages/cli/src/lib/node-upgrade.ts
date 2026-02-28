/**
 * Implementation of `fiber-pay node upgrade`.
 */

import { BinaryManager, type DownloadProgress, MigrationManager } from '@fiber-pay/node';
import type { CliConfig } from './config.js';
import { printJsonError, printJsonSuccess } from './format.js';
import { normalizeMigrationCheck, replaceRawMigrateHint } from './migration-utils.js';
import { isProcessRunning, readPidFile } from './pid.js';

export interface NodeUpgradeOptions {
  version?: string;
  backup?: boolean;
  checkOnly?: boolean;
  forceMigrate?: boolean;
  json?: boolean;
}

export async function runNodeUpgradeCommand(
  config: CliConfig,
  options: NodeUpgradeOptions,
): Promise<void> {
  const json = Boolean(options.json);
  const installDir = `${config.dataDir}/bin`;
  const binaryManager = new BinaryManager(installDir);

  // Step 1: Check if node is running — must be stopped before upgrade
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

  // Step 2: Resolve target version
  let targetTag: string;
  if (options.version) {
    targetTag = binaryManager.normalizeTag(options.version);
  } else {
    if (!json) console.log('🔍 Resolving latest Fiber release...');
    targetTag = await binaryManager.getLatestTag();
  }

  if (!json) console.log(`📦 Target version: ${targetTag}`);

  // Step 3: Check current version
  const currentInfo = await binaryManager.getBinaryInfo();
  const targetVersion = targetTag.startsWith('v') ? targetTag.slice(1) : targetTag;

  // Step 4: Prepare migration-related paths
  const storePath = MigrationManager.resolveStorePath(config.dataDir);
  const migrateBinaryPath = binaryManager.getMigrateBinaryPath();
  let migrationCheck: Awaited<ReturnType<MigrationManager['check']>> | null = null;

  const storeExists = MigrationManager.storeExists(config.dataDir);

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

    // Step 5: Download new binary (this also extracts fnn-migrate)
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

  // Step 6: Check migration if store exists
  if (storeExists) {
    migrationCheck = await runMigrationAndReport({
      migrateBinaryPath,
      storePath,
      json,
      checkOnly: Boolean(options.checkOnly),
      targetVersion,
      backup: options.backup !== false,
      forceMigrateAttempt: Boolean(options.forceMigrate),
    });
  }

  // Step 7: Final status
  const newInfo = await binaryManager.getBinaryInfo();
  if (json) {
    printJsonSuccess({
      action: 'upgraded',
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
  } = opts;

  // Instantiate MigrationManager
  let migrationManager: MigrationManager;
  try {
    migrationManager = new MigrationManager(migrateBinaryPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'fnn-migrate binary not available';
    if (json) {
      printJsonError({
        code: 'MIGRATION_TOOL_MISSING',
        message: msg,
        recoverable: true,
        suggestion:
          'Run `fiber-pay node upgrade` to reinstall binaries, then retry `fiber-pay node upgrade --force-migrate`.',
      });
    } else {
      console.error(`\n⚠️  ${msg}`);
      console.log(
        '   Run `fiber-pay node upgrade` to reinstall binaries, then retry `fiber-pay node upgrade --force-migrate`.',
      );
    }
    process.exit(1);
  }

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
          'Run `fiber-pay node upgrade` to reinstall binaries, then retry `fiber-pay node upgrade --force-migrate`.',
      });
    } else {
      console.error(`\n⚠️  Migration check failed: ${msg}`);
      console.log(
        '   Run `fiber-pay node upgrade` to reinstall binaries, then retry `fiber-pay node upgrade --force-migrate`.',
      );
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

  if (!migrationCheck.needed) {
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
