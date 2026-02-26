/**
 * Basic Payment Flow
 *
 * Demonstrates: connect to node → check balance → create invoice → send payment → wait for completion
 *
 * Prerequisites:
 * - Running Fiber node with at least one ChannelReady channel
 * - Testnet CKB funded
 *
 * Run: npx tsx examples/basic-payment.ts
 */

import { ckbToShannons, FiberRpcClient, randomBytes32, shannonsToCkb, toHex } from '@fiber-pay/sdk';

const RPC_URL = process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227';

async function main() {
  // 1. Create RPC client and verify node is reachable
  const client = new FiberRpcClient({ url: RPC_URL });

  console.log('Connecting to Fiber node...');
  await client.waitForReady({ timeout: 10000 });
  console.log('✓ Node is ready\n');

  // 2. Get node info
  const info = await client.nodeInfo();
  console.log('Node Info:');
  console.log(`  Node ID:  ${info.node_id}`);
  console.log(`  Version:  ${info.version}`);
  console.log(`  Channels: ${info.channel_count}`);
  console.log(`  Peers:    ${info.peers_count}\n`);

  // 3. Check channel balances
  const channels = await client.listChannels({});
  const readyChannels = channels.channels.filter((ch) => ch.state.state_name === 'ChannelReady');

  if (readyChannels.length === 0) {
    console.error('No ready channels. Open a channel first.');
    process.exit(1);
  }

  let totalLocal = 0n;
  let totalRemote = 0n;
  for (const ch of readyChannels) {
    totalLocal += BigInt(ch.local_balance);
    totalRemote += BigInt(ch.remote_balance);
    console.log(`Channel ${ch.channel_id.slice(0, 16)}...`);
    console.log(`  Local:  ${shannonsToCkb(ch.local_balance)} CKB`);
    console.log(`  Remote: ${shannonsToCkb(ch.remote_balance)} CKB`);
  }
  console.log(`\nTotal available to send: ${Number(totalLocal) / 1e8} CKB`);
  console.log(`Total available to receive: ${Number(totalRemote) / 1e8} CKB\n`);

  // 4. Create an invoice (receiving side)
  const preimage = randomBytes32();
  const amountCkb = 0.1; // 0.1 CKB

  console.log(`Creating invoice for ${amountCkb} CKB...`);
  const invoice = await client.newInvoice({
    amount: ckbToShannons(amountCkb),
    currency: 'Fibt', // Testnet
    description: 'Example payment',
    expiry: toHex(3600), // 1 hour
    payment_preimage: preimage,
    hash_algorithm: 'Sha256',
  });

  console.log(`✓ Invoice created`);
  console.log(`  Address:      ${invoice.invoice_address.slice(0, 40)}...`);
  console.log(`  Payment hash: ${invoice.invoice.data.payment_hash}\n`);

  // 5. Send payment (paying side — in a real scenario, this would be a different node)
  console.log('Sending payment...');
  const payment = await client.sendPayment({
    invoice: invoice.invoice_address,
    max_fee_amount: ckbToShannons(0.01), // Max 0.01 CKB fee
  });

  console.log(`✓ Payment initiated`);
  console.log(`  Hash:   ${payment.payment_hash}`);
  console.log(`  Status: ${payment.status}\n`);

  // 6. Wait for payment to complete
  console.log('Waiting for payment to complete...');
  const finalStatus = await client.waitForPayment(payment.payment_hash, {
    timeout: 60000, // 1 minute
    interval: 2000, // Poll every 2 seconds
  });

  console.log(`✓ Payment ${finalStatus.status}`);
  console.log(`  Fee: ${shannonsToCkb(finalStatus.fee)} CKB\n`);

  if (finalStatus.failed_error) {
    console.log(`  Error: ${finalStatus.failed_error}`);
  }

  console.log('Done!');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
