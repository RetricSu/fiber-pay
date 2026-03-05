import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { runWalletAddressCommand } from '../lib/wallet-address.js';
import { runWalletBalanceCommand } from '../lib/wallet-balance.js';

export function createWalletCommand(config: CliConfig): Command {
  const wallet = new Command('wallet').description('Wallet management');

  wallet
    .command('address')
    .description('Display the funding address')
    .option('--json')
    .action(async (options) => {
      await runWalletAddressCommand(config, options);
    });

  wallet
    .command('balance')
    .description('Display the CKB balance')
    .option('--json')
    .action(async (options) => {
      await runWalletBalanceCommand(config, options);
    });

  return wallet;
}
