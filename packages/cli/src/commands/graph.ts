import type { GraphChannelInfo, GraphNodeInfo } from '@fiber-pay/sdk';
import { shannonsToCkb, toHex } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { formatAge, parseHexTimestampMs, printJsonSuccess, truncateMiddle } from '../lib/format.js';
import { createReadyRpcClient } from '../lib/rpc.js';

function printGraphNodeListHuman(nodes: GraphNodeInfo[]): void {
  if (nodes.length === 0) {
    console.log('No nodes found in the graph.');
    return;
  }

  console.log(`Graph Nodes: ${nodes.length}`);
  console.log('');
  console.log('NODE ID                ALIAS                VERSION    MIN FUNDING    AGE');
  console.log('---------------------------------------------------------------------------------');

  for (const node of nodes) {
    const nodeId = truncateMiddle(node.pubkey, 10, 8).padEnd(22, ' ');
    const alias = (node.node_name || '(unnamed)').slice(0, 20).padEnd(20, ' ');
    const version = (node.version || '?').slice(0, 10).padEnd(10, ' ');
    const minFunding = shannonsToCkb(node.auto_accept_min_ckb_funding_amount)
      .toString()
      .padStart(12, ' ');
    const age = formatAge(parseHexTimestampMs(node.timestamp));
    console.log(`${nodeId} ${alias} ${version} ${minFunding} ${age}`);
  }
}

function printGraphChannelListHuman(channels: GraphChannelInfo[]): void {
  if (channels.length === 0) {
    console.log('No channels found in the graph.');
    return;
  }

  console.log(`Graph Channels: ${channels.length}`);
  console.log('');
  console.log(
    'OUTPOINT               NODE1                  NODE2                  CAPACITY     AGE',
  );
  console.log(
    '----------------------------------------------------------------------------------------------',
  );

  for (const ch of channels) {
    const outpoint = ch.channel_outpoint
      ? truncateMiddle(`${ch.channel_outpoint.tx_hash}:${ch.channel_outpoint.index}`, 10, 8)
      : 'n/a';
    const n1 = truncateMiddle(ch.node1, 10, 8).padEnd(22, ' ');
    const n2 = truncateMiddle(ch.node2, 10, 8).padEnd(22, ' ');
    const capacity = `${shannonsToCkb(ch.capacity)} CKB`.padStart(12, ' ');
    const age = formatAge(parseHexTimestampMs(ch.created_timestamp));
    console.log(`${outpoint.padEnd(22, ' ')} ${n1} ${n2} ${capacity} ${age}`);
  }
}

export function createGraphCommand(config: CliConfig): Command {
  const graph = new Command('graph').description('Network graph queries (nodes & channels)');

  graph
    .command('nodes')
    .option('--limit <n>', 'Maximum number of nodes to return', '50')
    .option('--after <cursor>', 'Pagination cursor from a previous query')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const limit = toHex(BigInt(parseInt(options.limit, 10)));
      const result = await rpc.graphNodes({
        limit,
        after: options.after,
      });

      if (options.json) {
        printJsonSuccess({ nodes: result.nodes, lastCursor: result.last_cursor });
      } else {
        printGraphNodeListHuman(result.nodes);
        if (result.last_cursor && result.last_cursor !== '0x0') {
          console.log(`\nNext cursor: ${result.last_cursor}`);
        }
      }
    });

  graph
    .command('channels')
    .option('--limit <n>', 'Maximum number of channels to return', '50')
    .option('--after <cursor>', 'Pagination cursor from a previous query')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const limit = toHex(BigInt(parseInt(options.limit, 10)));
      const result = await rpc.graphChannels({
        limit,
        after: options.after,
      });

      if (options.json) {
        printJsonSuccess({ channels: result.channels, lastCursor: result.last_cursor });
      } else {
        printGraphChannelListHuman(result.channels);
        if (result.last_cursor && result.last_cursor !== '0x0') {
          console.log(`\nNext cursor: ${result.last_cursor}`);
        }
      }
    });

  return graph;
}
