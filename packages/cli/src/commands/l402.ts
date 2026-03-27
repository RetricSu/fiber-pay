import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { runL402ProxyCommand } from '../lib/l402-proxy.js';

export function createL402Command(config: CliConfig): Command {
  const l402 = new Command('l402').description('L402 payment protocol commands');

  l402
    .command('proxy')
    .description('Start a reverse proxy with L402 payment gating')
    .requiredOption('--target <url>', 'Upstream server URL to forward paid requests to')
    .option('--port <port>', 'Listen port', '8402')
    .option('--host <host>', 'Listen host', '127.0.0.1')
    .option('--price <ckb>', 'Price per request in CKB', '0.1')
    .option('--root-key <hex>', 'Macaroon root key (32-byte hex, or set L402_ROOT_KEY env)')
    .option('--expiry <seconds>', 'Token expiry in seconds', '3600')
    .option('--json')
    .action(async (options) => {
      await runL402ProxyCommand(config, options);
    });

  return l402;
}
