import type { Channel, GraphChannelInfo, GraphNodeInfo, PeerInfo } from '@fiber-pay/sdk';
import { shannonsToCkb, toHex } from '@fiber-pay/sdk';
import type { CliConfig } from './config.js';
import {
  formatShannonsAsCkb,
  printJsonSuccess,
  sanitizeForTerminal,
  truncateMiddle,
} from './format.js';
import { createReadyRpcClient } from './rpc.js';

export interface NodeNetworkOptions {
  json?: boolean;
}

export interface EnrichedPeerInfo extends PeerInfo {
  nodeInfo?: GraphNodeInfo;
}

export interface EnrichedChannelInfo extends Channel {
  peerNodeInfo?: GraphNodeInfo;
  graphChannelInfo?: GraphChannelInfo;
}

export interface NodeNetworkData {
  localNodeId: string;
  peers: EnrichedPeerInfo[];
  channels: EnrichedChannelInfo[];
  graphNodes: GraphNodeInfo[];
  graphChannels: GraphChannelInfo[];
  summary: {
    connectedPeers: number;
    activeChannels: number;
    totalChannelCapacity: string;
  };
}

export async function runNodeNetworkCommand(
  config: CliConfig,
  options: NodeNetworkOptions,
): Promise<void> {
  const rpc = await createReadyRpcClient(config);

  // Fetch all required data
  const [nodeInfo, localPeers, localChannels, graphNodes, graphChannels] = await Promise.all([
    rpc.nodeInfo(),
    rpc.listPeers(),
    rpc.listChannels({ include_closed: false }),
    rpc.graphNodes({}),
    rpc.graphChannels({}),
  ]);

  // Create lookup maps for efficient data enrichment
  const graphNodesMap = new Map<string, GraphNodeInfo>();
  for (const node of graphNodes.nodes) {
    graphNodesMap.set(node.node_id, node);
  }

  // Create peer_id to node_id mapping from connected peers
  const peerIdToNodeIdMap = new Map<string, string>();
  for (const peer of localPeers.peers) {
    peerIdToNodeIdMap.set(peer.peer_id, peer.pubkey);
  }

  const graphChannelsMap = new Map<string, GraphChannelInfo>();
  for (const channel of graphChannels.channels) {
    if (channel.channel_outpoint) {
      const outpointKey = `${channel.channel_outpoint.tx_hash}:${channel.channel_outpoint.index}`;
      graphChannelsMap.set(outpointKey, channel);
    }
  }

  // Enrich peer information
  const enrichedPeers: EnrichedPeerInfo[] = localPeers.peers.map((peer) => ({
    ...peer,
    nodeInfo: graphNodesMap.get(peer.pubkey),
  }));

  // Enrich channel information
  const enrichedChannels: EnrichedChannelInfo[] = localChannels.channels.map((channel) => {
    // Try to find node_id from peer_id mapping first, then fallback to direct lookup
    const nodeId = peerIdToNodeIdMap.get(channel.peer_id) || channel.peer_id;
    const peerNodeInfo = graphNodesMap.get(nodeId);
    let graphChannelInfo: GraphChannelInfo | undefined;

    // Try to find the graph channel info by matching outpoint
    if (channel.channel_outpoint) {
      const outpointKey = `${channel.channel_outpoint.tx_hash}:${channel.channel_outpoint.index}`;
      graphChannelInfo = graphChannelsMap.get(outpointKey);
    }

    return {
      ...channel,
      peerNodeInfo,
      graphChannelInfo,
    };
  });

  // Calculate summary statistics
  const activeChannels = enrichedChannels.filter((ch) => ch.state?.state_name === 'CHANNEL_READY');
  const totalChannelCapacityShannons = activeChannels.reduce((sum, ch) => {
    const capacity = ch.graphChannelInfo?.capacity
      ? ch.graphChannelInfo.capacity
      : toHex(BigInt(ch.local_balance) + BigInt(ch.remote_balance));
    return sum + BigInt(capacity);
  }, 0n);
  const totalChannelCapacity = formatShannonsAsCkb(totalChannelCapacityShannons, 1);

  const networkData: NodeNetworkData = {
    localNodeId: nodeInfo.node_id,
    peers: enrichedPeers,
    channels: enrichedChannels,
    graphNodes: graphNodes.nodes,
    graphChannels: graphChannels.channels,
    summary: {
      connectedPeers: enrichedPeers.length,
      activeChannels: activeChannels.length,
      totalChannelCapacity,
    },
  };

  if (options.json) {
    printJsonSuccess(networkData);
    return;
  }

  // Human-readable output
  printNodeNetworkHuman(networkData);
}

function printNodeNetworkHuman(data: NodeNetworkData): void {
  console.log('Node Network Overview');
  console.log('=====================');
  console.log('');
  console.log(`Connected Peers: ${data.summary.connectedPeers}`);
  console.log(`Active Channels: ${data.summary.activeChannels}`);
  console.log(`Total Channel Capacity: ${data.summary.totalChannelCapacity} CKB`);
  console.log('');

  // Print peers table
  if (data.peers.length > 0) {
    console.log('Peers:');
    console.log('  PEER_ID                ALIAS                ADDRESS                    VERSION');
    console.log(
      '  --------------------------------------------------------------------------------',
    );

    for (const peer of data.peers) {
      const peerId = truncateMiddle(peer.peer_id, 10, 8).padEnd(22, ' ');
      const alias = sanitizeForTerminal(peer.nodeInfo?.node_name || '(unnamed)')
        .slice(0, 20)
        .padEnd(20, ' ');
      const address = truncateMiddle(sanitizeForTerminal(peer.address), 15, 8).padEnd(25, ' ');
      const version = sanitizeForTerminal(peer.nodeInfo?.version || '?')
        .slice(0, 8)
        .padEnd(8, ' ');
      console.log(`  ${peerId} ${alias} ${address} ${version}`);
    }
    console.log('');
  }

  // Print channels table
  if (data.channels.length > 0) {
    console.log('Channels:');
    console.log(
      '  CHANNEL_ID             PEER_ALIAS           STATE          LOCAL_BAL     REMOTE_BAL   CAPACITY',
    );
    console.log(
      '  -----------------------------------------------------------------------------------------------',
    );

    for (const channel of data.channels) {
      const channelId = truncateMiddle(channel.channel_id, 10, 8).padEnd(22, ' ');
      const peerAlias = sanitizeForTerminal(channel.peerNodeInfo?.node_name || '(unnamed)')
        .slice(0, 18)
        .padEnd(18, ' ');
      const state = (channel.state?.state_name || 'UNKNOWN').slice(0, 13).padEnd(13, ' ');
      const localBal = shannonsToCkb(channel.local_balance).toFixed(1).padStart(11, ' ');
      const remoteBal = shannonsToCkb(channel.remote_balance).toFixed(1).padStart(11, ' ');
      const capacity = channel.graphChannelInfo?.capacity
        ? shannonsToCkb(channel.graphChannelInfo.capacity).toFixed(1).padStart(8, ' ')
        : shannonsToCkb(toHex(BigInt(channel.local_balance) + BigInt(channel.remote_balance)))
            .toFixed(1)
            .padStart(8, ' ');

      console.log(`  ${channelId} ${peerAlias} ${state} ${localBal} ${remoteBal} ${capacity}`);
    }
  }
}
