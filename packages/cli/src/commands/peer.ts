import { nodeIdToPeerId } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonSuccess, printPeerListHuman } from '../lib/format.js';
import { createReadyRpcClient } from '../lib/rpc.js';

function extractPeerIdFromMultiaddr(address: string): string | undefined {
  const match = address.match(/\/p2p\/([^/]+)$/);
  return match?.[1];
}

async function findPeerByPeerId(
  rpc: Awaited<ReturnType<typeof createReadyRpcClient>>,
  expectedPeerId: string,
) {
  const peers = await rpc.listPeers();
  for (const peer of peers.peers) {
    if (extractPeerIdFromMultiaddr(peer.address) === expectedPeerId) {
      return peer;
    }
    try {
      if ((await nodeIdToPeerId(peer.pubkey)) === expectedPeerId) {
        return peer;
      }
    } catch {
      // Ignore malformed pubkeys and continue scanning peer list.
    }
  }
  return undefined;
}

async function waitForPeerConnected(
  rpc: Awaited<ReturnType<typeof createReadyRpcClient>>,
  expectedPeerId: string,
  timeoutMs: number,
): Promise<{ pubkey: string; address: string } | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const match = await findPeerByPeerId(rpc, expectedPeerId);
    if (match) {
      return { pubkey: match.pubkey, address: match.address };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}

export function createPeerCommand(config: CliConfig): Command {
  const peer = new Command('peer').description('Peer management');

  peer
    .command('list')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const peers = await rpc.listPeers();
      if (options.json) {
        printJsonSuccess(peers);
      } else {
        printPeerListHuman(peers.peers);
      }
    });

  peer
    .command('connect')
    .argument('<multiaddr>')
    .option('--timeout <sec>', 'Wait timeout for peer to appear in peer list', '8')
    .option('--json')
    .action(async (address, options) => {
      const rpc = await createReadyRpcClient(config);
      const expectedPeerId = extractPeerIdFromMultiaddr(address);
      if (!expectedPeerId) {
        throw new Error('Invalid multiaddr: missing /p2p/<peerId> suffix');
      }

      await rpc.connectPeer({ address });
      const timeoutMs = Math.max(1, Number.parseInt(String(options.timeout), 10) || 8) * 1000;
      const connected = await waitForPeerConnected(rpc, expectedPeerId, timeoutMs);

      if (!connected) {
        throw new Error(
          `connect_peer accepted but peer not found in list within ${Math.floor(timeoutMs / 1000)}s (${expectedPeerId})`,
        );
      }

      if (options.json) {
        printJsonSuccess({
          address,
          peerId: expectedPeerId,
          pubkey: connected.pubkey,
          message: 'Connected',
        });
      } else {
        console.log('✅ Connected to peer');
        console.log(`  Address: ${address}`);
        console.log(`  Peer ID: ${expectedPeerId}`);
        console.log(`  Peer Pubkey: ${connected.pubkey}`);
      }
    });

  peer
    .command('disconnect')
    .argument('<pubkey>')
    .option('--json')
    .action(async (pubkey, options) => {
      const rpc = await createReadyRpcClient(config);
      await rpc.disconnectPeer({ pubkey });

      if (options.json) {
        printJsonSuccess({ pubkey, message: 'Disconnected' });
      } else {
        console.log('✅ Disconnected peer');
        console.log(`  Peer Pubkey: ${pubkey}`);
      }
    });

  return peer;
}
