/**
 * Implementation of `fiber-pay node upgrade`.
 */

import { BinaryManager, type DownloadProgress, MigrationManager } from '@fiber-pay/node';
import type { CliConfig } from './config.js';
import { printJsonError, printJsonSuccess } from './format.js';
import { isProcessRunning, readPidFile } from './pid.js';

export interface NodeUpgradeOptions {
  version?: string;
  backup?: boolean;
  checkOnly?: boolean;
  force?: boolean;
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

  if (currentInfo.ready && currentInfo.version === targetVersion && !options.force) {
    const msg = `Already installed ${targetTag}. Use --force to re-download.`;
    if (json) {
      printJsonSuccess({
        action: 'none',
        currentVersion: currentInfo.version,
        targetVersion,
        message: msg,
      });
    } else {
      console.log(`✅ ${msg}`);
    }
    return;
  }

  if (!json && currentInfo.ready) {
    console.log(`   Current version: v${currentInfo.version}`);
  }

  // Step 4: Prepare migration-related paths
  const storePath = MigrationManager.resolveStorePath(config.dataDir);
  const migrateBinaryPath = binaryManager.getMigrateBinaryPath();
  let migrationCheck: Awaited<ReturnType<MigrationManager['check']>> | null = null;

  const storeExists = MigrationManager.storeExists(config.dataDir);

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

  // Step 6: Check migration if store exists
  if (storeExists) {
    migrationCheck = await runMigrationAndReport({
      migrateBinaryPath,
      storePath,
      json,
      checkOnly: Boolean(options.checkOnly),
      targetVersion,
      backup: options.backup !== false,
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
  const { migrateBinaryPath, storePath, json, checkOnly, targetVersion, backup } = opts;

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
          'Re-download the binary with: fiber-pay node upgrade --force, or choose a version that includes fnn-migrate.',
      });
    } else {
      console.error(`\n⚠️  ${msg}`);
      console.log('   Re-download with --force, or choose a version that includes fnn-migrate.');
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
          'Re-download the binary with: fiber-pay node upgrade --force, or choose a version that includes fnn-migrate.',
      });
    } else {
      console.error(`\n⚠️  Migration check failed: ${msg}`);
      console.log('   Re-download with --force, or choose a version that includes fnn-migrate.');
    }
    process.exit(1);
  }

  // --check-only: report and let the caller return
  if (checkOnly) {
    if (json) {
      printJsonSuccess({
        action: 'check-only',
        targetVersion,
        migration: migrationCheck,
      });
    } else {
      console.log(`\n📋 Migration status: ${migrationCheck.message}`);
    }
    // Signal to caller to return early
    process.exit(0);
  }

  if (!migrationCheck.needed) {
    if (!json) console.log('   Store is compatible, no migration needed.');
    return migrationCheck;
  }

  // Breaking change — cannot auto-migrate
  if (!migrationCheck.valid) {
    if (json) {
      printJsonError({
        code: 'MIGRATION_INCOMPATIBLE',
        message: migrationCheck.message,
        recoverable: false,
        suggestion: 'Close all channels with the old fnn version, remove the store, then restart.',
        details: { storePath, migrationCheck },
      });
    } else {
      console.error('\n❌ Store migration is not possible automatically.');
      console.log(migrationCheck.message);
    }
    process.exit(1);
  }

  // Run migration
  if (!json) console.log('🔄 Running database migration...');

  const result = await migrationManager.migrate({
    storePath,
    backup,
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

  return migrationCheck;
}
