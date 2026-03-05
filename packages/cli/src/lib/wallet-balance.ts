import type { CliConfig } from './config.js';
import { printJsonSuccess } from './format.js';
import { getLockBalanceShannons } from './node-rpc.js';
import { createReadyRpcClient } from './rpc.js';

export interface WalletBalanceOptions {
  json?: boolean;
}

export async function runWalletBalanceCommand(
  config: CliConfig,
  options: WalletBalanceOptions,
): Promise<void> {
  if (!config.ckbRpcUrl) {
    throw new Error(
      'CKB RPC URL is not configured. Set FIBER_CKB_RPC_URL or add ckb.rpc_url to config.yml.',
    );
  }

  const rpc = await createReadyRpcClient(config);
  const nodeInfo = await rpc.nodeInfo();

  // Get CKB balance using the funding lock script
  const balanceShannons = await getLockBalanceShannons(
    config.ckbRpcUrl,
    nodeInfo.default_funding_lock_script,
  );

  // Convert shannons to CKB (1 CKB = 10^8 shannons)
  const balanceCkb = Number(balanceShannons) / 100_000_000;

  if (options.json) {
    printJsonSuccess({
      balance_ckb: balanceCkb.toString(),
      balance_shannons: balanceShannons.toString(),
    });
    return;
  }

  console.log('✅ CKB balance retrieved');
  console.log(`  Balance: ${balanceCkb.toFixed(8)} CKB`);
  console.log(`  Balance (shannons): ${balanceShannons.toString()}`);
}
