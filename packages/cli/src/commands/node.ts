import { BinaryManager, type DownloadProgress, MigrationManager } from '@fiber-pay/node';
import { nodeIdToPeerId, scriptToAddress } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonError, printJsonSuccess, printNodeInfoHuman } from '../lib/format.js';
import { stopRuntimeDaemonFromNode } from '../lib/node-runtime-daemon.js';
import { runNodeStartCommand } from '../lib/node-start.js';
import { runNodeReadyCommand, runNodeStatusCommand } from '../lib/node-status.js';
import { isProcessRunning, readPidFile, removePidFile } from '../lib/pid.js';
import { createReadyRpcClient } from '../lib/rpc.js';
import { readRuntimeMeta, readRuntimePid, removeRuntimeFiles } from '../lib/runtime-meta.js';

export function createNodeCommand(config: CliConfig): Command {
  const node = new Command('node').description('Node management');

  node
    .command('start')
    .option('--daemon', 'Start node in detached background mode (node + runtime)')
    .option('--runtime-proxy-listen <host:port>', 'Runtime monitor proxy listen address')
    .option('--event-stream <format>', 'Event stream format for --json mode (jsonl)', 'jsonl')
    .option('--quiet-fnn', 'Do not mirror fnn stdout/stderr to console; keep file persistence')
    .option('--json')
    .action(async (options) => {
      await runNodeStartCommand(config, options);
    });

  node
    .command('stop')
    .option('--json')
    .action(async (options) => {
      const json = Boolean(options.json);
      const runtimeMeta = readRuntimeMeta(config.dataDir);
      const runtimePid = readRuntimePid(config.dataDir);
      if (runtimeMeta?.daemon && runtimePid && isProcessRunning(runtimePid)) {
        stopRuntimeDaemonFromNode({ dataDir: config.dataDir, rpcUrl: config.rpcUrl });
      }
      removeRuntimeFiles(config.dataDir);

      const pid = readPidFile(config.dataDir);
      if (!pid) {
        if (json) {
          printJsonError({
            code: 'NODE_NOT_RUNNING',
            message: 'No PID file found. Node may not be running.',
            recoverable: true,
            suggestion: 'Run `fiber-pay node start` first if you intend to stop a node.',
          });
        } else {
          console.log('❌ No PID file found. Node may not be running.');
        }
        process.exit(1);
      }

      if (!isProcessRunning(pid)) {
        if (json) {
          printJsonError({
            code: 'NODE_NOT_RUNNING',
            message: `Process ${pid} is not running. Cleaning up PID file.`,
            recoverable: true,
            suggestion: 'Start the node again if needed; stale PID has been cleaned.',
            details: { pid, stalePidFileCleaned: true },
          });
        } else {
          console.log(`❌ Process ${pid} is not running. Cleaning up PID file.`);
        }
        removePidFile(config.dataDir);
        process.exit(1);
      }

      if (!json) {
        console.log(`🛑 Stopping node (PID: ${pid})...`);
      }
      process.kill(pid, 'SIGTERM');

      let attempts = 0;
      while (isProcessRunning(pid) && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      if (isProcessRunning(pid)) {
        process.kill(pid, 'SIGKILL');
      }

      removePidFile(config.dataDir);
      if (json) {
        printJsonSuccess({ pid, stopped: true });
      } else {
        console.log('✅ Node stopped.');
      }
    });

  node
    .command('status')
    .option('--json')
    .action(async (options) => {
      await runNodeStatusCommand(config, options);
    });

  node
    .command('ready')
    .description('Agent-oriented readiness summary for automation')
    .option('--json')
    .action(async (options) => {
      await runNodeReadyCommand(config, options);
    });

  node
    .command('info')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const nodeInfo = await rpc.nodeInfo();
      const fundingAddress = scriptToAddress(nodeInfo.default_funding_lock_script, config.network);
      const peerId = await nodeIdToPeerId(nodeInfo.node_id);
      const output = {
        nodeId: nodeInfo.node_id,
        peerId,
        addresses: nodeInfo.addresses,
        chainHash: nodeInfo.chain_hash,
        fundingAddress,
        fundingLockScript: nodeInfo.default_funding_lock_script,
        version: nodeInfo.version,
        channelCount: parseInt(nodeInfo.channel_count, 16),
        pendingChannelCount: parseInt(nodeInfo.pending_channel_count, 16),
        peersCount: parseInt(nodeInfo.peers_count, 16),
      };

      if (options.json) {
        printJsonSuccess(output);
      } else {
        printNodeInfoHuman(output);
      }
    });

  // --- node upgrade ---
  node
    .command('upgrade')
    .description('Upgrade the Fiber node binary and migrate the database if needed')
    .option('--version <version>', 'Target Fiber version (default: latest)')
    .option('--no-backup', 'Skip creating a store backup before migration')
    .option('--check-only', 'Only check if migration is needed, do not migrate')
    .option('--force', 'Force re-download the binary even if same version')
    .option('--json')
    .action(async (options) => {
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
        const msg = `Already running ${targetTag}. Use --force to re-download.`;
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

      // Step 4: Check store migration status
      const storePath = MigrationManager.resolveStorePath(config.dataDir);
      const migrateBinaryPath = binaryManager.getMigrateBinaryPath();
      let migrationCheck: Awaited<ReturnType<MigrationManager['check']>> | null = null;

      // We need to download first to get fnn-migrate, then check migration
      // But we can check if store exists first
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
        const migrationManager = new MigrationManager(migrateBinaryPath);

        if (!json) console.log('🔍 Checking store compatibility...');
        migrationCheck = await migrationManager.check(storePath);

        if (options.checkOnly) {
          if (json) {
            printJsonSuccess({
              action: 'check-only',
              targetVersion,
              migration: migrationCheck,
            });
          } else {
            console.log(`\n📋 Migration status: ${migrationCheck.message}`);
          }
          return;
        }

        if (migrationCheck.needed) {
          if (!migrationCheck.valid) {
            // Breaking change — cannot auto-migrate
            if (json) {
              printJsonError({
                code: 'MIGRATION_INCOMPATIBLE',
                message: migrationCheck.message,
                recoverable: false,
                suggestion:
                  'Close all channels with the old fnn version, remove the store, then restart.',
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
            migrateBinaryPath,
            storePath,
            backup: options.backup !== false,
          });

          if (!result.success) {
            if (json) {
              printJsonError({
                code: 'MIGRATION_FAILED',
                message: result.message,
                recoverable: !!result.backupPath,
                suggestion: result.backupPath
                  ? `Rollback with: rm -rf "${storePath}" && mv "${result.backupPath}" "${storePath}"`
                  : 'Re-download the previous version or start fresh.',
                details: { output: result.output, backupPath: result.backupPath },
              });
            } else {
              console.error(`\n❌ Migration failed.`);
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
        } else {
          if (!json) console.log('   Store is compatible, no migration needed.');
        }
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
        console.log(`\n✅ Upgrade complete!`);
        console.log(`   Version: v${newInfo.version}`);
        console.log(`   Binary:  ${newInfo.path}`);
        console.log(`\n   Start the node with: fiber-pay node start`);
      }
    });

  return node;
}
