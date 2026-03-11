import { scriptToAddress } from '@fiber-pay/sdk';
import qrcode from 'qrcode';
import type { CliConfig } from './config.js';
import { printJsonSuccess } from './format.js';
import { createReadyRpcClient } from './rpc.js';

export interface WalletAddressOptions {
  json?: boolean;
  qrcode?: boolean;
}

function truncateAddress(address: string, startLen = 8, endLen = 6): string {
  if (address.length <= startLen + endLen + 3) return address;
  return `${address.slice(0, startLen)}...${address.slice(-endLen)}`;
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
    console.log('✅ Funding address retrieved\n');
    const qrString = await qrcode.toString(address, { type: 'terminal', small: true });
    console.log(qrString);
    console.log(`  ${truncateAddress(address)}`);
    return;
  }

  console.log('✅ Funding address retrieved');
  console.log(`  Address: ${address}`);
}
