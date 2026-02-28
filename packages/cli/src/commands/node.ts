import { nodeIdToPeerId, scriptToAddress } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonSuccess, printNodeInfoHuman } from '../lib/format.js';
import { runNodeStartCommand } from '../lib/node-start.js';
import { runNodeReadyCommand, runNodeStatusCommand } from '../lib/node-status.js';
import { runNodeStopCommand } from '../lib/node-stop.js';
import { runNodeUpgradeCommand } from '../lib/node-upgrade.js';
import { createReadyRpcClient } from '../lib/rpc.js';

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
      await runNodeStopCommand(config, options);
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

  node
    .command('upgrade')
    .description('Upgrade the Fiber node binary and migrate the database if needed')
    .option('--version <version>', 'Target Fiber version (default: latest)')
    .option('--no-backup', 'Skip creating a store backup before migration')
    .option('--check-only', 'Only check if migration is needed, do not migrate')
    .option(
      '--force-migrate',
      'Force migration attempt even when compatibility check reports incompatible data',
    )
    .option('--json')
    .action(async (options) => {
      await runNodeUpgradeCommand(config, options);
    });

  return node;
}
