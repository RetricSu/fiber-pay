import type { CliConfig } from './config.js';
import { printJsonSuccess } from './format.js';
import { createReadyRpcClient } from './rpc.js';

export interface NodeInfoOptions {
  json?: boolean;
}

export async function runNodeInfoCommand(
  config: CliConfig,
  options: NodeInfoOptions,
): Promise<void> {
  const rpc = await createReadyRpcClient(config);
  const nodeInfo = await rpc.nodeInfo();

  if (options.json) {
    printJsonSuccess(nodeInfo);
    return;
  }

  console.log('✅ Node info retrieved');
  console.log(`  Node ID: ${nodeInfo.node_id}`);
  console.log(`  Version: ${nodeInfo.version}`);
  console.log(`  Commit: ${nodeInfo.commit_hash}`);
  console.log(`  Name: ${nodeInfo.node_name ?? '-'}`);
  console.log(`  Chain Hash: ${nodeInfo.chain_hash}`);
  console.log(`  Peers: ${BigInt(nodeInfo.peers_count)}`);
  console.log(`  Channels: ${BigInt(nodeInfo.channel_count)}`);
  console.log(`  Pending Channels: ${BigInt(nodeInfo.pending_channel_count)}`);
  if (nodeInfo.addresses.length > 0) {
    console.log('  Addresses:');
    for (const address of nodeInfo.addresses) {
      console.log(`    - ${address}`);
    }
  }
}
