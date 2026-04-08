import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonSuccess, printPeerListHuman } from '../lib/format.js';
import { createReadyRpcClient } from '../lib/rpc.js';

function extractPubkeyFromMultiaddr(address: string): string | undefined {
  const match = address.match(/\/p2p\/([^/]+)$/);
  return match?.[1];
}

async function waitForPeerConnected(
  rpc: Awaited<ReturnType<typeof createReadyRpcClient>>,
  expectedPubkey: string,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const peers = await rpc.listPeers();
    if (peers.peers.some((peer) => peer.pubkey === expectedPubkey)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
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
      const hintedPubkey = extractPubkeyFromMultiaddr(address);
      if (!hintedPubkey) {
        throw new Error('Invalid multiaddr: missing /p2p/<pubkey> suffix');
      }

      await rpc.connectPeer({ address });
      const timeoutMs = Math.max(1, Number.parseInt(String(options.timeout), 10) || 8) * 1000;
      const connected = await waitForPeerConnected(rpc, hintedPubkey, timeoutMs);

      if (!connected) {
        throw new Error(
          `connect_peer accepted but peer not found in list within ${Math.floor(timeoutMs / 1000)}s (${hintedPubkey})`,
        );
      }

      if (options.json) {
        printJsonSuccess({ address, pubkey: hintedPubkey, message: 'Connected' });
      } else {
        console.log('✅ Connected to peer');
        console.log(`  Address: ${address}`);
        console.log(`  Peer Pubkey: ${hintedPubkey}`);
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
