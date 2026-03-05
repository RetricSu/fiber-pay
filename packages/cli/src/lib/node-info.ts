import type { CliConfig } from './config.js';
import { printJsonSuccess, sanitizeForTerminal } from './format.js';
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
  console.log(`  Version: ${nodeInfo.version}`);
  console.log(`  Commit: ${nodeInfo.commit_hash}`);
  console.log(`  Node ID: ${nodeInfo.node_id}`);
  if (nodeInfo.features.length > 0) {
    console.log('  Features:');
    for (const feature of nodeInfo.features) {
      console.log(`    - ${sanitizeForTerminal(feature)}`);
    }
  }
  console.log(`  Name: ${sanitizeForTerminal(nodeInfo.node_name ?? '-')}`);
  if (nodeInfo.addresses.length > 0) {
    console.log('  Addresses:');
    for (const address of nodeInfo.addresses) {
      console.log(`    - ${sanitizeForTerminal(address)}`);
    }
  }
  console.log(`  Chain Hash: ${nodeInfo.chain_hash}`);
  console.log(`  Channels: ${BigInt(nodeInfo.channel_count)}`);
  console.log(`  Pending Channels: ${BigInt(nodeInfo.pending_channel_count)}`);
  console.log(`  Peers: ${BigInt(nodeInfo.peers_count)}`);
  if (nodeInfo.udt_cfg_infos.length > 0) {
    console.log('  UDT Configs:');
    for (const udt of nodeInfo.udt_cfg_infos) {
      console.log(`    - Name: ${sanitizeForTerminal(udt.name)}`);
      console.log(`      Script: ${JSON.stringify(udt.script, null, 6)}`);
      if (udt.auto_accept_amount) {
        console.log(`      Auto Accept Amount: ${BigInt(udt.auto_accept_amount)}`);
      }
      if (udt.cell_deps.length > 0) {
        console.log('      Cell Deps:');
        for (const dep of udt.cell_deps) {
          console.log(
            `        - Cell Dep: ${dep.cell_dep ? JSON.stringify(dep.cell_dep) : 'null'}`,
          );
          console.log(`          Type ID: ${dep.type_id ? JSON.stringify(dep.type_id) : 'null'}`);
        }
      }
    }
  }
}
