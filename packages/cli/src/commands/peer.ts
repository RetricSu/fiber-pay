import { buildMultiaddrFromNodeId, type HexString, nodeIdToPeerId } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonSuccess, printPeerListHuman } from '../lib/format.js';
import { createReadyRpcClient } from '../lib/rpc.js';

function isPubkey(value: string): boolean {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.replace(/^0x/i, '');
  return /^[0-9a-fA-F]+$/.test(withoutPrefix) && withoutPrefix.length === 66;
}

function normalizePubkey(value: string): string {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.replace(/^0x/i, '');
  return `0x${withoutPrefix.toLowerCase()}`;
}

function extractPeerIdFromMultiaddr(address: string): string | undefined {
  const match = address.match(/\/p2p\/([^/]+)$/);
  return match?.[1];
}

async function findPeerByTarget(
  rpc: Awaited<ReturnType<typeof createReadyRpcClient>>,
  target: string,
) {
  const peers = await rpc.listPeers();
  const targetIsPubkey = isPubkey(target);
  const normalizedTarget = targetIsPubkey ? normalizePubkey(target) : target;
  for (const peer of peers.peers) {
    if (targetIsPubkey) {
      if (normalizePubkey(peer.pubkey) === normalizedTarget) {
        return peer;
      }
      continue;
    }
    if (extractPeerIdFromMultiaddr(peer.address) === target) {
      return peer;
    }
    try {
      if ((await nodeIdToPeerId(peer.pubkey)) === target) {
        return peer;
      }
    } catch {
      // Ignore malformed pubkeys and continue scanning peer list.
    }
  }
  return undefined;
}

async function waitForPeerConnectedByTarget(
  rpc: Awaited<ReturnType<typeof createReadyRpcClient>>,
  target: string,
  timeoutMs: number,
): Promise<{ pubkey: string; address: string } | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const match = await findPeerByTarget(rpc, target);
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
    .argument('<multiaddrOrPubkey>')
    .option('--address <addr>', 'Optional peer address (multiaddr) to connect to')
    .option('--timeout <sec>', 'Wait timeout for peer to appear in peer list', '8')
    .option('--json')
    .action(async (input, options) => {
      const rpc = await createReadyRpcClient(config);
      const trimmedInput = input.trim();

      let connectParams: { address: string } | { pubkey: HexString };
      let targetForWait: string;

      if (isPubkey(trimmedInput)) {
        const normalized = normalizePubkey(trimmedInput) as HexString;
        if (options.address) {
          const address = String(options.address).trim().replace(/\/+$/, '');
          if (!address.startsWith('/')) {
            throw new Error('Invalid --address: expected a multiaddr starting with "/"');
          }
          const multiaddr = await buildMultiaddrFromNodeId(address, normalized);
          connectParams = { address: multiaddr };
          targetForWait = normalized;
        } else {
          connectParams = { pubkey: normalized };
          targetForWait = normalized;
        }
      } else if (trimmedInput.startsWith('/')) {
        const peerId = extractPeerIdFromMultiaddr(trimmedInput);
        if (!peerId) {
          throw new Error(
            'Invalid multiaddr: missing /p2p/<peerId> suffix. ' +
              'Provide a bare multiaddr with --address when using a pubkey as the first argument.',
          );
        }
        if (options.address) {
          throw new Error('Cannot use --address when the first argument is already a multiaddr');
        }
        connectParams = { address: trimmedInput };
        targetForWait = peerId;
      } else {
        throw new Error(
          'Invalid argument: expected a pubkey (66 hex chars) or a multiaddr starting with "/"',
        );
      }

      await rpc.connectPeer(connectParams);
      const timeoutMs = Math.max(1, Number.parseInt(String(options.timeout), 10) || 8) * 1000;
      const connected = await waitForPeerConnectedByTarget(rpc, targetForWait, timeoutMs);

      if (!connected) {
        throw new Error(
          `connect_peer accepted but peer not found in list within ${Math.floor(timeoutMs / 1000)}s (${trimmedInput})`,
        );
      }

      if (options.json) {
        printJsonSuccess({
          address: connected.address,
          pubkey: connected.pubkey,
          message: 'Connected',
        });
      } else {
        console.log('✅ Connected to peer');
        console.log(`  Address: ${connected.address}`);
        console.log(`  Peer Pubkey: ${connected.pubkey}`);
      }
    });

  peer
    .command('disconnect')
    .argument('<pubkey>')
    .option('--json')
    .action(async (pubkey, options) => {
      const rpc = await createReadyRpcClient(config);
      const normalized = normalizePubkey(pubkey) as HexString;
      await rpc.disconnectPeer({ pubkey: normalized });

      if (options.json) {
        printJsonSuccess({ pubkey: normalized, message: 'Disconnected' });
      } else {
        console.log('✅ Disconnected peer');
        console.log(`  Peer Pubkey: ${normalized}`);
      }
    });

  return peer;
}
