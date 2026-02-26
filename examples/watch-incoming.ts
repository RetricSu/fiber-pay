/**
 * Watch for Incoming Payments
 *
 * Demonstrates using watchIncomingPayments() to monitor invoices for
 * incoming payments with graceful shutdown via AbortController.
 *
 * This pattern is useful for:
 * - Payment notification services
 * - Merchant point-of-sale systems
 * - Automated escrow settlement
 *
 * Prerequisites:
 * - Running Fiber node with at least one open channel
 *
 * Run: npx tsx examples/watch-incoming.ts
 */

import { ckbToShannons, FiberRpcClient, randomBytes32, shannonsToCkb, toHex } from '@fiber-pay/sdk';

const RPC_URL = process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227';

async function main() {
  const client = new FiberRpcClient({ url: RPC_URL });

  console.log('Connecting to Fiber node...');
  await client.waitForReady({ timeout: 10000 });
  console.log('✓ Node is ready\n');

  // 1. Create a few invoices to watch
  const invoiceHashes: `0x${string}`[] = [];
  const amounts = [0.1, 0.5, 1.0]; // CKB amounts

  console.log('Creating invoices to watch:');
  for (const amount of amounts) {
    const preimage = randomBytes32();
    const invoice = await client.newInvoice({
      amount: ckbToShannons(amount),
      currency: 'Fibt',
      description: `Watch example - ${amount} CKB`,
      expiry: toHex(3600),
      payment_preimage: preimage,
      hash_algorithm: 'Sha256',
    });

    invoiceHashes.push(invoice.invoice.data.payment_hash);
    console.log(`  ${amount} CKB → ${invoice.invoice_address.slice(0, 40)}...`);
    console.log(`    Hash: ${invoice.invoice.data.payment_hash.slice(0, 20)}...`);
  }
  console.log();

  // 2. Set up the watcher with AbortController for graceful shutdown
  const controller = new AbortController();

  // Handle Ctrl+C for graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down watcher...');
    controller.abort();
  });

  console.log('Watching for incoming payments (Ctrl+C to stop)...');
  console.log('Pay any of the invoices above to see notifications.\n');

  // 3. Start watching
  const watchPromise = client.watchIncomingPayments({
    paymentHashes: invoiceHashes,
    interval: 3000, // Check every 3 seconds
    signal: controller.signal,
    onPayment: (invoice) => {
      const amount = invoice.invoice.amount ? shannonsToCkb(invoice.invoice.amount) : 0;
      console.log(`🔔 Payment received!`);
      console.log(`   Hash:   ${invoice.invoice.data.payment_hash.slice(0, 20)}...`);
      console.log(`   Amount: ${amount} CKB`);
      console.log(`   Status: ${invoice.status}`);
      console.log();
    },
  });

  // 4. Optional: Auto-stop after 5 minutes
  const timeoutId = setTimeout(
    () => {
      console.log('\nTimeout reached (5 minutes). Stopping watcher...');
      controller.abort();
    },
    5 * 60 * 1000,
  );

  // Wait for watcher to complete (either by abort or timeout)
  await watchPromise;

  clearTimeout(timeoutId);
  console.log('Watcher stopped. Done!');
}

main().catch((err) => {
  if (err.name !== 'AbortError') {
    console.error('Error:', err.message);
    process.exit(1);
  }
});
