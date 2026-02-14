import { type DownloadProgress, downloadFiberBinary, getFiberBinaryInfo } from '@fiber-pay/node';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJson } from '../lib/format.js';

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
    .option('--version <version>', 'Fiber binary version', 'v0.6.1')
    .option('--force', 'Force re-download')
    .option('--json')
    .action(async (options) => {
      const info = await downloadFiberBinary({
        installDir: `${config.dataDir}/bin`,
        version: options.version,
        force: Boolean(options.force),
        onProgress: showProgress,
      });

      if (options.json) {
        printJson({ success: true, data: info });
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
      const info = await getFiberBinaryInfo(`${config.dataDir}/bin`);

      if (options.json) {
        printJson({ success: true, data: info });
      } else {
        console.log(info.ready ? '✅ Binary is ready' : '❌ Binary not found or not executable');
        console.log(`  Path:    ${info.path}`);
        console.log(`  Version: ${info.version}`);
      }
    });

  return binary;
}
