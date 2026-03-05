import { scriptToAddress } from '@fiber-pay/sdk';
import type { CliConfig } from './config.js';
import { printJsonSuccess } from './format.js';
import { createReadyRpcClient } from './rpc.js';

export interface WalletAddressOptions {
  json?: boolean;
}

export async function runWalletAddressCommand(
  config: CliConfig,
  options: WalletAddressOptions,
): Promise<void> {
  const rpc = await createReadyRpcClient(config);
  const nodeInfo = await rpc.nodeInfo();

  const address = scriptToAddress(
    nodeInfo.default_funding_lock_script,
    config.network === 'mainnet' ? 'mainnet' : 'testnet',
  );

  if (options.json) {
    printJsonSuccess({ address });
    return;
  }

  console.log('✅ Funding address retrieved');
  console.log(`  Address: ${address}`);
}
