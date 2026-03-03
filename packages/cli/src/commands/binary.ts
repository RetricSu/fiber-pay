import {
  DEFAULT_FIBER_VERSION,
  type DownloadProgress,
  downloadFiberBinary,
  getFiberBinaryInfo,
} from '@fiber-pay/node';
import { Command } from 'commander';
import { resolveBinaryPath } from '../lib/binary-path.js';
import type { CliConfig } from '../lib/config.js';
import { printJsonSuccess } from '../lib/format.js';
import { getCustomBinaryState } from '../lib/node-runtime-daemon.js';

function showProgress(progress: DownloadProgress): void {
  const percent = progress.percent !== undefined ? ` (${progress.percent}%)` : '';
  process.stdout.write(`\r[${progress.phase}]${percent} ${progress.message}`.padEnd(80));
  if (progress.phase === 'installing') {
    console.log();
  }
}

export function createBinaryCommand(config: CliConfig): Command {
  const binary = new Command('binary').description('Fiber binary management');

  binary
    .command('download')
    .option('--version <version>', 'Fiber binary version', DEFAULT_FIBER_VERSION)
    .option('--force', 'Force re-download')
    .option('--json')
    .action(async (options) => {
      const resolvedBinary = resolveBinaryPath(config);
      const info = await downloadFiberBinary({
        installDir: resolvedBinary.installDir,
        version: options.version,
        force: Boolean(options.force),
        onProgress: options.json ? undefined : showProgress,
      });

      if (options.json) {
        printJsonSuccess({
          ...info,
          source: resolvedBinary.source,
          resolvedPath: resolvedBinary.binaryPath,
        });
      } else {
        console.log('\n✅ Binary installed successfully!');
        console.log(`  Path:    ${info.path}`);
        console.log(`  Version: ${info.version}`);
        console.log(`  Ready:   ${info.ready ? 'yes' : 'no'}`);
      }
    });

  binary
    .command('info')
    .option('--json')
    .action(async (options) => {
      const resolvedBinary = resolveBinaryPath(config);
      const info = config.binaryPath
        ? getCustomBinaryState(resolvedBinary.binaryPath)
        : await getFiberBinaryInfo(resolvedBinary.installDir);

      if (options.json) {
        printJsonSuccess({
          ...info,
          source: resolvedBinary.source,
          resolvedPath: resolvedBinary.binaryPath,
        });
      } else {
        console.log(info.ready ? '✅ Binary is ready' : '❌ Binary not found or not executable');
        console.log(`  Path:    ${info.path}`);
        console.log(`  Version: ${info.version}`);
      }
    });

  return binary;
}
