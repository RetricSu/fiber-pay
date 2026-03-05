import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { runNodeInfoCommand } from '../lib/node-info.js';
import { runNodeNetworkCommand } from '../lib/node-network.js';
import { runNodeStartCommand } from '../lib/node-start.js';
import { runNodeReadyCommand, runNodeStatusCommand } from '../lib/node-status.js';
import { runNodeStopCommand } from '../lib/node-stop.js';
import { runNodeUpgradeCommand } from '../lib/node-upgrade.js';

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
    .command('network')
    .description('Display comprehensive network topology and connections')
    .option('--json')
    .action(async (options) => {
      await runNodeNetworkCommand(config, options);
    });

  node
    .command('info')
    .description('Display information about the running node')
    .option('--json')
    .action(async (options) => {
      await runNodeInfoCommand(config, options);
    });

  node
    .command('ready')
    .description('Agent-oriented readiness summary for automation')
    .option('--json')
    .action(async (options) => {
      await runNodeReadyCommand(config, options);
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
