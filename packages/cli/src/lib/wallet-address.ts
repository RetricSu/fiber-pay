import { scriptToAddress } from '@fiber-pay/sdk';
import type { CliConfig } from './config.js';
import { printJsonSuccess, truncateMiddle } from './format.js';
import { createReadyRpcClient } from './rpc.js';

export interface WalletAddressOptions {
  json?: boolean;
  qrcode?: boolean;
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

  if (options.qrcode) {
    const qrcode = await import('qrcode');
    console.log('✅ Funding address retrieved\n');
    const qrString = await qrcode.toString(address, { type: 'terminal', small: true });
    console.log(qrString);
    console.log(`  ${truncateMiddle(address, 8, 6)}`);
    return;
  }

  console.log('✅ Funding address retrieved');
  console.log(`  Address: ${address}`);
}
