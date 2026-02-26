/**
 * Channel Lifecycle
 *
 * Demonstrates the full channel lifecycle:
 * 1. Connect to a peer
 * 2. Open a channel with funding
 * 3. Wait for channel to become ready (on-chain confirmation)
 * 4. Send a test payment
 * 5. Cooperatively close the channel
 *
 * Prerequisites:
 * - Running Fiber node with on-chain CKB for funding
 * - A reachable peer to connect to
 *
 * Run: PEER_ADDR="/ip4/x.x.x.x/tcp/8228/p2p/QmXXX" npx tsx examples/channel-lifecycle.ts
 */

import { ckbToShannons, FiberRpcClient, shannonsToCkb } from '@fiber-pay/sdk';

const RPC_URL = process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227';

// Testnet bootnode — replace with your target peer
const PEER_ADDR =
  process.env.PEER_ADDR ||
  '/ip4/54.179.226.154/tcp/8228/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy';

async function main() {
  const client = new FiberRpcClient({ url: RPC_URL });

  console.log('Connecting to Fiber node...');
  await client.waitForReady({ timeout: 10000 });
  console.log('✓ Node is ready\n');

  // 1. Connect to peer
  const peerIdMatch = PEER_ADDR.match(/\/p2p\/([^/]+)/);
  if (!peerIdMatch) {
    console.error('Invalid peer address format. Expected /ip4/.../tcp/.../p2p/QmXXX');
    process.exit(1);
  }
  const peerId = peerIdMatch[1];

  console.log(`Connecting to peer ${peerId.slice(0, 12)}...`);
  try {
    await client.connectPeer({ address: PEER_ADDR });
    console.log('✓ Connected to peer\n');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Already connected is OK
    if (!msg.includes('already connected')) {
      throw err;
    }
    console.log('✓ Already connected to peer\n');
  }

  // 2. Open a channel
  const fundingCkb = 200; // 200 CKB minimum recommended
  console.log(`Opening channel with ${fundingCkb} CKB funding...`);

  const channel = await client.openChannel({
    peer_id: peerId,
    funding_amount: ckbToShannons(fundingCkb),
    public: true,
  });

  const channelId = channel.temporary_channel_id;
  console.log(`✓ Channel opening initiated`);
  console.log(`  Temporary ID: ${channelId.slice(0, 20)}...\n`);

  // 3. Wait for channel to become ready
  //    This waits for the funding transaction to be confirmed on-chain
  //    Typical time: 30-60 seconds on testnet
  console.log('Waiting for channel to become ready (on-chain confirmation)...');
  console.log('  This may take 30-60 seconds on testnet...\n');

  const readyChannel = await client.waitForChannelReady(channelId, {
    timeout: 300000, // 5 minutes
    interval: 5000, // Check every 5 seconds
  });

  console.log(`✓ Channel is ready!`);
  console.log(`  Channel ID: ${readyChannel.channel_id.slice(0, 20)}...`);
  console.log(`  Local balance:  ${shannonsToCkb(readyChannel.local_balance)} CKB`);
  console.log(`  Remote balance: ${shannonsToCkb(readyChannel.remote_balance)} CKB\n`);

  // 4. List all channels to see the full picture
  const allChannels = await client.listChannels({});
  console.log(`Total channels: ${allChannels.channels.length}`);
  for (const ch of allChannels.channels) {
    console.log(
      `  ${ch.channel_id.slice(0, 16)}... [${ch.state.state_name}] ${shannonsToCkb(ch.local_balance)} CKB`,
    );
  }
  console.log();

  // 5. Close the channel cooperatively
  console.log('Closing channel cooperatively...');
  await client.shutdownChannel({
    channel_id: readyChannel.channel_id,
    force: false,
  });

  console.log('✓ Channel close initiated (cooperative)');
  console.log('  Funds will be returned to your on-chain address.\n');

  console.log('Done! Channel lifecycle complete.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
