import { join } from 'node:path';
import { Command } from 'commander';
import { createBinaryCommand } from './commands/binary.js';
import { createChannelCommand } from './commands/channel.js';
import { createConfigCommand } from './commands/config.js';
import { createGraphCommand } from './commands/graph.js';
import { createInvoiceCommand } from './commands/invoice.js';
import { createJobCommand } from './commands/job.js';
import { createLogsCommand } from './commands/logs.js';
import { createNodeCommand } from './commands/node.js';
import { createPaymentCommand } from './commands/payment.js';
import { createPeerCommand } from './commands/peer.js';
import { createRuntimeCommand } from './commands/runtime.js';
import { createVersionCommand } from './commands/version.js';
import { isTopLevelVersionRequest } from './lib/argv.js';
import { CLI_COMMIT, CLI_VERSION } from './lib/build-info.js';
import { getEffectiveConfig } from './lib/config.js';
import { printJsonError } from './lib/format.js';

function shouldOutputJson(): boolean {
  return process.argv.includes('--json');
}

function getFlagValue(argv: string[], index: number): string | undefined {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    return undefined;
  }
  return value;
}

/** Tracks which config keys were explicitly set via CLI flags. */
const explicitFlags = new Set<string>();

function applyGlobalOverrides(argv: string[]): void {
  let explicitDataDir = false;
  let profileName: string | undefined;
  explicitFlags.clear();

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case '--profile': {
        const value = getFlagValue(argv, index);
        if (value) profileName = value;
        break;
      }
      case '--data-dir': {
        const value = getFlagValue(argv, index);
        if (value) {
          process.env.FIBER_DATA_DIR = value;
          explicitDataDir = true;
          explicitFlags.add('dataDir');
        }
        break;
      }
      case '--rpc-url': {
        const value = getFlagValue(argv, index);
        if (value) {
          process.env.FIBER_RPC_URL = value;
          explicitFlags.add('rpcUrl');
        }
        break;
      }
      case '--rpc-biscuit-token': {
        const value = getFlagValue(argv, index);
        if (value) {
          process.env.FIBER_RPC_BISCUIT_TOKEN = value;
          explicitFlags.add('rpcBiscuitToken');
        }
        break;
      }
      case '--network': {
        const value = getFlagValue(argv, index);
        if (value) {
          process.env.FIBER_NETWORK = value;
          explicitFlags.add('network');
        }
        break;
      }
      case '--key-password': {
        const value = getFlagValue(argv, index);
        if (value) {
          process.env.FIBER_KEY_PASSWORD = value;
          explicitFlags.add('keyPassword');
        }
        break;
      }
      case '--binary-path': {
        const value = getFlagValue(argv, index);
        if (value) {
          process.env.FIBER_BINARY_PATH = value;
          explicitFlags.add('binaryPath');
        }
        break;
      }
      case '--runtime-proxy-listen':
      case '--proxy-listen': {
        const value = getFlagValue(argv, index);
        if (value) {
          process.env.FIBER_RUNTIME_PROXY_LISTEN = value;
          explicitFlags.add('runtimeProxyListen');
        }
        break;
      }
      default:
        break;
    }
  }

  if (!explicitDataDir && profileName) {
    const homeDir = process.env.HOME ?? process.cwd();
    process.env.FIBER_DATA_DIR = join(homeDir, '.fiber-pay', 'profiles', profileName);
  }
}

function printFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const commanderCode =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;

  if (shouldOutputJson()) {
    printJsonError({
      code: commanderCode ?? 'CLI_FATAL',
      message,
      recoverable: !commanderCode || commanderCode.startsWith('commander.'),
      suggestion: commanderCode?.startsWith('commander.')
        ? 'Run the command with --help and fix invalid arguments.'
        : 'Inspect command arguments and environment, then retry.',
    });
  } else {
    if (commanderCode?.startsWith('commander.')) {
      return;
    }
    console.error('Fatal error:', message);
  }
}

async function main(): Promise<void> {
  const argv = process.argv;

  if (isTopLevelVersionRequest(argv)) {
    console.log(`${CLI_VERSION} (${CLI_COMMIT})`);
    return;
  }

  applyGlobalOverrides(argv);
  const config = getEffectiveConfig(explicitFlags).config;

  const program = new Command();
  program
    .name('fiber-pay')
    .description('AI Agent Payment SDK for CKB Lightning Network')
    .option('--profile <name>', 'Use profile at ~/.fiber-pay/profiles/<name>')
    .option('--data-dir <path>', 'Override data directory for all commands')
    .option('--rpc-url <url>', 'Override RPC URL for all commands')
    .option('--rpc-biscuit-token <token>', 'Set RPC Authorization Bearer token for all commands')
    .option('--network <network>', 'Override network for all commands (testnet|mainnet)')
    .option('--key-password <password>', 'Override key password for all commands')
    .option('--binary-path <path>', 'Override fiber binary path for all commands')
    .showHelpAfterError()
    .showSuggestionAfterError();

  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => {
      if (!shouldOutputJson()) {
        process.stderr.write(str);
      }
    },
  });

  program.addCommand(createNodeCommand(config));
  program.addCommand(createChannelCommand(config));
  program.addCommand(createInvoiceCommand(config));
  program.addCommand(createPaymentCommand(config));
  program.addCommand(createJobCommand(config));
  program.addCommand(createLogsCommand(config));
  program.addCommand(createPeerCommand(config));
  program.addCommand(createGraphCommand(config));
  program.addCommand(createBinaryCommand(config));
  program.addCommand(createConfigCommand(config));
  program.addCommand(createRuntimeCommand(config));
  program.addCommand(createVersionCommand());

  await program.parseAsync(argv);
}

main().catch((error) => {
  const commanderCode =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  const commanderExitCode =
    error && typeof error === 'object' && 'exitCode' in error
      ? Number((error as { exitCode: unknown }).exitCode)
      : undefined;

  printFatal(error);

  if (commanderCode?.startsWith('commander.') && commanderExitCode === 0) {
    process.exit(0);
  }

  process.exit(1);
});
