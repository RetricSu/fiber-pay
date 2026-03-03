import { DEFAULT_FIBER_VERSION, type DownloadProgress, downloadFiberBinary } from '@fiber-pay/node';
import { Command } from 'commander';
import {
  getBinaryDetails,
  getBinaryManagerInstallDirOrThrow,
  resolveBinaryPath,
} from '../lib/binary-path.js';
import type { CliConfig } from '../lib/config.js';
import { printJsonError, printJsonSuccess } from '../lib/format.js';

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
      let installDir: string;
      try {
        installDir = getBinaryManagerInstallDirOrThrow(resolvedBinary);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) {
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

      const info = await downloadFiberBinary({
        installDir,
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
      const { resolvedBinary, info } = await getBinaryDetails(config);

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
