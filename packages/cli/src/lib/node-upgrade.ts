/**
 * Implementation of `fiber-pay node upgrade`.
 */

import { LegacyMigration, resolveStorePath, storeExists } from '@fiber-pay/node';
import type { ResolvedBinaryPath } from './binary-path.js';
import { getBinaryManagerInstallDirOrThrow, resolveBinaryPath } from './binary-path.js';
import type { CliConfig } from './config.js';
import { loadProfileConfig, saveProfileConfig } from './config.js';
import { printJsonError, printJsonSuccess } from './format.js';
import { getCustomBinaryState } from './node-runtime-daemon.js';
import { resolveManagedUpgradeVersion } from './node-version-policy.js';
import { isProcessRunning, readPidFile } from './pid.js';

export interface NodeUpgradeOptions {
  version?: string;
  backup?: boolean;
  checkOnly?: boolean;
  json?: boolean;
}

export type NodeUpgradeMode = 'managed-download' | 'custom-binary';

export function getNodeUpgradeMode(resolvedBinary: ResolvedBinaryPath): NodeUpgradeMode {
  return resolvedBinary.source === 'profile-managed' ? 'managed-download' : 'custom-binary';
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

  if (mode === 'custom-binary') {
    const currentInfo = getCustomBinaryState(resolvedBinary.binaryPath);

    if (!json) {
      console.log('🧭 Upgrade mode: custom binary.');
      console.log(`🧩 Binary: ${resolvedBinary.binaryPath}`);
      if (currentInfo.ready) {
        console.log(`🧩 Current version: ${currentInfo.version}`);
      }
    }

    const legacyMigration = await runLegacyMigrationIfNeeded({
      dataDir: config.dataDir,
      json,
      checkOnly: Boolean(options.checkOnly),
      backup: options.backup !== false,
    });

    if (json) {
      printJsonSuccess({
        action: 'migrate-only',
        mode,
        source: resolvedBinary.source,
        currentVersion: currentInfo.version,
        binaryPath: resolvedBinary.binaryPath,
        legacyMigration: legacyMigration.result ?? null,
      });
    } else {
      console.log('\n✅ Upgrade flow complete (custom binary mode).');
      console.log('   Binary download was skipped by design.');
      console.log('   Legacy migration was run when a store was found.');
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

  const { BinaryManager } = await import('@fiber-pay/node');
  const binaryManager = new BinaryManager(installDir);

  // Resolve target version
  const upgradeVersion = await resolveManagedUpgradeVersion(binaryManager, options.version);
  const targetTag = upgradeVersion.targetTag;
  const targetVersion = upgradeVersion.targetVersion;
  if (upgradeVersion.source === 'latest' && !json) {
    console.log('🔍 Resolving latest Fiber release...');
  }

  if (!json) console.log(`📦 Target version: ${targetTag}`);

  if (options.checkOnly) {
    await runLegacyMigrationIfNeeded({
      dataDir: config.dataDir,
      json,
      checkOnly: true,
      backup: false,
    });
  }

  // Check current version
  const currentInfo = await binaryManager.getBinaryInfo();

  if (!json && storeExists(config.dataDir)) {
    console.log('📂 Existing store detected.');
  }

  if (currentInfo.ready && currentInfo.version === targetVersion) {
    const legacyMigration = await runLegacyMigrationIfNeeded({
      dataDir: config.dataDir,
      json,
      checkOnly: Boolean(options.checkOnly),
      backup: options.backup !== false,
    });

    const msg = legacyMigration.ran
      ? `Already installed ${targetTag}. Legacy migration completed.`
      : `Already installed ${targetTag}. Store is ready.`;
    if (json) {
      printJsonSuccess({
        action: 'none',
        currentVersion: currentInfo.version,
        targetVersion,
        message: msg,
        legacyMigration: legacyMigration.result ?? null,
      });
    } else {
      console.log(`✅ ${msg}`);
    }
    return;
  }

  if (!json && currentInfo.ready) {
    console.log(`   Current version: v${currentInfo.version}`);
  }

  if (!json && storeExists(config.dataDir)) {
    console.log('📂 Existing store detected, will run legacy migration after download.');
  }

  // Download new binary
  if (!json) console.log('⬇️  Downloading new binary...');

  const showProgress = (progress: { phase: string; percent?: number; message: string }) => {
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

  // Run legacy migration if store exists
  const legacyMigration = await runLegacyMigrationIfNeeded({
    dataDir: config.dataDir,
    json,
    checkOnly: Boolean(options.checkOnly),
    backup: options.backup !== false,
  });

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
      legacyMigration: legacyMigration.result ?? null,
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

interface LegacyMigrationRunOptions {
  dataDir: string;
  json: boolean;
  checkOnly: boolean;
  backup: boolean;
}

async function runLegacyMigrationIfNeeded(
  opts: LegacyMigrationRunOptions,
): Promise<{ ran: boolean; result?: { success: boolean; message: string; backupPath?: string } }> {
  const { dataDir, json, checkOnly, backup } = opts;

  if (!storeExists(dataDir)) {
    if (checkOnly) {
      if (json) {
        printJsonSuccess({
          action: 'check-only',
          message: 'No store detected. No migration needed.',
        });
      } else {
        console.log('📋 No store detected. No migration needed.');
      }
      process.exit(0);
    }
    return { ran: false };
  }

  const storePath = resolveStorePath(dataDir);

  if (checkOnly) {
    if (json) {
      printJsonSuccess({
        action: 'check-only',
        message: 'Store exists. Legacy migration would run if needed.',
      });
    } else {
      console.log('📋 Store exists. Legacy migration would run if needed.');
    }
    process.exit(0);
  }

  if (!json) {
    console.log('🔄 Preparing store for fnn v0.9.0-rc4...');
  }

  const legacy = new LegacyMigration('v0.8.1');
  const result = await legacy.migrate({ storePath, backup });

  if (!result.success) {
    if (json) {
      printJsonError({
        code: 'MIGRATION_FAILED',
        message: result.message,
        recoverable: !!result.backupPath,
        suggestion: result.backupPath
          ? `To roll back, delete the current store at "${storePath}" and restore the backup from "${result.backupPath}".`
          : 'Inspect the migration output and retry.',
        details: { output: result.output, backupPath: result.backupPath },
      });
    } else {
      console.error(`\n❌ ${result.message}`);
      if (result.backupPath) {
        console.log(`   Backup: ${result.backupPath}`);
      }
    }
    process.exit(1);
  }

  if (!json) {
    console.log(`✅ ${result.message}`);
    if (result.backupPath) {
      console.log(`   Backup: ${result.backupPath}`);
    }
  }

  return { ran: true, result };
}
