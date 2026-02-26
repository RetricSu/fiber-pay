/**
 * Hold Invoice (Escrow) Flow
 *
 * Demonstrates the hold invoice pattern for conditional/escrow payments:
 * 1. Receiver creates invoice with payment_hash (no preimage upfront)
 * 2. Payer sends payment — funds are held in-flight
 * 3. Receiver verifies conditions are met
 * 4. Receiver settles invoice by revealing preimage — funds released
 *
 * This enables trustless escrow: the receiver only gets paid when they
 * prove they've fulfilled their obligations by revealing the preimage.
 *
 * Prerequisites:
 * - Two connected Fiber nodes with a funded channel between them
 *
 * Run: npx tsx examples/hold-invoice.ts
 */

import { createHash, randomBytes } from 'node:crypto';
import type { HexString } from '@fiber-pay/sdk';
import { ckbToShannons, FiberRpcClient, toHex } from '@fiber-pay/sdk';

const RPC_URL = process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227';

/**
 * Generate a random preimage and its SHA-256 hash
 */
function generatePreimageAndHash(): { preimage: HexString; hash: HexString } {
  const preimageBytes = randomBytes(32);
  const hashBytes = createHash('sha256').update(preimageBytes).digest();

  return {
    preimage: `0x${preimageBytes.toString('hex')}` as HexString,
    hash: `0x${hashBytes.toString('hex')}` as HexString,
  };
}

async function main() {
  const client = new FiberRpcClient({ url: RPC_URL });

  console.log('Connecting to Fiber node...');
  await client.waitForReady({ timeout: 10000 });
  console.log('✓ Node is ready\n');

  // === RECEIVER SIDE ===

  // 1. Generate preimage and hash
  //    In a real escrow, the receiver generates these and keeps the preimage secret
  const { preimage, hash: paymentHash } = generatePreimageAndHash();
  console.log('Generated escrow credentials:');
  console.log(`  Payment hash: ${paymentHash.slice(0, 20)}...`);
  console.log(`  Preimage:     ${preimage.slice(0, 20)}... (kept secret)\n`);

  // 2. Create hold invoice with the hash (NOT the preimage)
  const amountCkb = 1; // 1 CKB escrow
  console.log(`Creating hold invoice for ${amountCkb} CKB...`);

  const invoice = await client.newInvoice({
    amount: ckbToShannons(amountCkb),
    currency: 'Fibt',
    description: 'Escrow: payment held until service delivered',
    expiry: toHex(7200), // 2 hours
    payment_hash: paymentHash, // Key difference: hash, not preimage!
    hash_algorithm: 'Sha256',
  });

  console.log(`✓ Hold invoice created`);
  console.log(`  Invoice: ${invoice.invoice_address.slice(0, 40)}...\n`);

  // === PAYER SIDE ===

  // 3. Payer sends payment (funds are held, not yet settled)
  console.log('Payer sending payment to hold invoice...');
  const payment = await client.sendPayment({
    invoice: invoice.invoice_address,
    max_fee_amount: ckbToShannons(0.01),
  });

  console.log(`✓ Payment initiated: ${payment.status}`);
  console.log(`  Hash: ${payment.payment_hash}\n`);

  // === RECEIVER SIDE (continued) ===

  // 4. Wait for invoice to be "Received" (funds are held)
  console.log('Waiting for payment to be held (Received status)...');
  const acceptedInvoice = await client.waitForInvoiceStatus(paymentHash, 'Received', {
    timeout: 60000,
    interval: 2000,
  });

  console.log(`✓ Payment held! Invoice status: ${acceptedInvoice.status}`);
  console.log('  Funds are locked — payer cannot cancel, receiver can settle or let expire\n');

  // 5. Verify conditions (in a real app, check if service was delivered)
  console.log('Verifying escrow conditions...');
  const conditionsMet = true; // Simulate: conditions are met
  console.log(`  Conditions met: ${conditionsMet}\n`);

  if (conditionsMet) {
    // 6. Settle the invoice by revealing the preimage
    console.log('Settling hold invoice (revealing preimage)...');
    await client.settleInvoice({
      payment_hash: paymentHash,
      payment_preimage: preimage,
    });

    console.log('✓ Invoice settled! Funds released to receiver.\n');

    // 7. Verify final status
    const finalInvoice = await client.getInvoice({ payment_hash: paymentHash });
    console.log(`Final invoice status: ${finalInvoice.status}`); // Should be "Paid"
  } else {
    // If conditions not met, let the invoice expire
    // Funds return to payer automatically
    console.log('Conditions not met. Invoice will expire and funds return to payer.');
  }

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
