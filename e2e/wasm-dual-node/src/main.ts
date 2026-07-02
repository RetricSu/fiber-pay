/**
 * Fiber WASM Dual-Node E2E (Testnet)
 *
 * Runs two WASM Fiber nodes in the same browser context and walks through the
 * full payment flow on CKB testnet:
 * 1. Start node A and node B with distinct ports / database prefixes
 * 2. Verify both nodes have pre-funded testnet CKB
 * 3. Connect A ↔ B as peers
 * 4. Open a channel from A to B
 * 5. Wait for the channel to become ready
 * 6. Create an invoice on B
 * 7. Send payment from A to B
 * 8. Wait for payment success
 * 9. Close the channel
 * 10. Stop both nodes
 *
 * Account / funding keys mirror scripts/e2e-testnet-dual-node.mjs so the same
 * pre-funded testnet addresses can be reused.
 */

import {
  ChannelState,
  type Channel,
  type NodeInfoResult,
  RawKeyCredentialProvider,
  FiberBrowserNode,
  buildMultiaddr,
  nodeIdToPeerId,
} from '@fiber-pay/sdk/browser';
import { formatShannonsAsCkb, getLockBalanceShannons } from '@sdk/browser/ckb-balance';

// =============================================================================
// Configuration — mirrors e2e-testnet-dual-node.mjs
// =============================================================================

const RUN_ID = Date.now();

const TESTNET_CKB_RPC = 'https://testnet.ckbapp.dev/';

const FIXED_NODE_A_FIBER_SK_HEX =
  '0000000000000000000000000000000000000000000000000000000000000001';
const FIXED_NODE_B_FIBER_SK_HEX =
  '0000000000000000000000000000000000000000000000000000000000000002';
const FIXED_NODE_A_CKB_SK_HEX =
  '0000000000000000000000000000000000000000000000000000000000000011';
const FIXED_NODE_B_CKB_SK_HEX =
  '0000000000000000000000000000000000000000000000000000000000000012';

const NODE_A_P2P_ADDR = '/ip4/127.0.0.1/tcp/18228';
const NODE_A_RPC_ADDR = '127.0.0.1:18227';
const NODE_B_P2P_ADDR = '/ip4/127.0.0.1/tcp/18238';
const NODE_B_RPC_ADDR = '127.0.0.1:18237';

const CHANNEL_FUNDING_CKB = 200;
const INVOICE_AMOUNT_CKB = 1;
const MIN_FUNDING_BALANCE_CKB = CHANNEL_FUNDING_CKB + INVOICE_AMOUNT_CKB + 5;

const NODE_READY_TIMEOUT_MS = 120_000;
const CHANNEL_READY_TIMEOUT_MS = 360_000;
const PAYMENT_TIMEOUT_MS = 180_000;
const CHANNEL_CLOSE_TIMEOUT_MS = 360_000;
const POLL_INTERVAL_MS = 3_000;

// =============================================================================
// Logging
// =============================================================================

const logEl = document.getElementById('log')!;

function log(msg: string, cls: 'ok' | 'err' | 'info' | 'highlight' = 'info') {
  const ts = new Date().toISOString().split('T')[1].replace('Z', '');
  const line = document.createElement('span');
  line.className = cls;
  line.textContent = `[${ts}] ${msg}\n`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log(`[${cls}] ${msg}`);
}

function pass(label: string) {
  log(`✅ PASS: ${label}`, 'ok');
}

function fail(label: string, err: unknown) {
  log(`❌ FAIL: ${label}: ${err}`, 'err');
}

function printSummary(passed: number, failed: number) {
  log('', 'info');
  log(`=== Summary: ${passed} passed, ${failed} failed ===`, failed > 0 ? 'err' : 'ok');
  document.title = failed > 0
    ? `FAIL: ${passed} passed, ${failed} failed`
    : `PASS: ${passed} passed, ${failed} failed`;
}

// =============================================================================
// Helpers
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`Invalid 32-byte hex string: ${hex}`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNodeReady(
  node: FiberBrowserNode,
  label: string,
  timeoutMs = NODE_READY_TIMEOUT_MS,
): Promise<NodeInfoResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = await node.nodeInfo();
      if (info.pubkey) return info;
    } catch {
      // Not ready yet; keep polling.
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Node ${label} was not ready within ${timeoutMs}ms`);
}

async function checkFundingBalance(node: FiberBrowserNode, label: string) {
  const info = await node.nodeInfo();
  const shannons = await getLockBalanceShannons(TESTNET_CKB_RPC, info.default_funding_lock_script);
  const ckb = Number(formatShannonsAsCkb(shannons));
  if (!Number.isFinite(ckb) || ckb < MIN_FUNDING_BALANCE_CKB) {
    throw new Error(
      `Node ${label} funding balance ${ckb} CKB is below ` +
        `MIN_FUNDING_BALANCE_CKB=${MIN_FUNDING_BALANCE_CKB}. ` +
        `Please pre-fund the fixed testnet address first.`,
    );
  }
  pass(`${label} funding balance: ${ckb} CKB`);
}

function findLatestChannel(channels: Channel[], peerPubkey: string): Channel | undefined {
  const candidates = channels.filter(
    (ch) => ch.pubkey === peerPubkey && typeof ch.channel_id === 'string',
  );
  if (candidates.length === 0) return undefined;

  return candidates.sort((left, right) => {
    const l = BigInt(left.created_at ?? '0x0');
    const r = BigInt(right.created_at ?? '0x0');
    if (l === r) return 0;
    return l > r ? -1 : 1;
  })[0];
}

async function waitForChannelState(
  node: FiberBrowserNode,
  peerPubkey: string,
  targetState: ChannelState,
  timeoutMs: number,
): Promise<Channel> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { channels } = await node.listChannels({ include_closed: true });
    const channel = findLatestChannel(channels, peerPubkey);
    if (channel && channel.state.state_name === targetState) {
      return channel;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Channel with ${peerPubkey} did not reach ${targetState} within ${timeoutMs}ms`);
}

async function closeAnyExistingChannels(node: FiberBrowserNode, peerPubkey: string) {
  const { channels } = await node.listChannels({ include_closed: true });
  const active = channels.filter(
    (ch) => ch.pubkey === peerPubkey && ch.state.state_name !== ChannelState.Closed,
  );
  for (const ch of active) {
    log(`Closing pre-existing channel ${ch.channel_id}`, 'info');
    try {
      await node.shutdownChannel({ channel_id: ch.channel_id });
    } catch {
      await node.shutdownChannel({ channel_id: ch.channel_id, force: true });
    }
  }
  if (active.length > 0) {
    await waitForChannelState(node, peerPubkey, ChannelState.Closed, CHANNEL_CLOSE_TIMEOUT_MS);
  }
}

// =============================================================================
// Main E2E
// =============================================================================

async function runE2E() {
  log('=== Fiber WASM Dual-Node E2E (Testnet) ===', 'highlight');
  let passed = 0;
  let failed = 0;

  const nodeA = new FiberBrowserNode({
    network: 'testnet',
    credential: new RawKeyCredentialProvider(
      hexToBytes(FIXED_NODE_A_FIBER_SK_HEX),
      hexToBytes(FIXED_NODE_A_CKB_SK_HEX),
      `dual-node-a-${RUN_ID}`,
    ),
    nodeConfig: {
      p2pListeningAddr: NODE_A_P2P_ADDR,
      rpcListeningAddr: NODE_A_RPC_ADDR,
      databasePrefix: `/wasm-dual-node-a-${RUN_ID}`,
    },
  });

  const nodeB = new FiberBrowserNode({
    network: 'testnet',
    credential: new RawKeyCredentialProvider(
      hexToBytes(FIXED_NODE_B_FIBER_SK_HEX),
      hexToBytes(FIXED_NODE_B_CKB_SK_HEX),
      `dual-node-b-${RUN_ID}`,
    ),
    nodeConfig: {
      p2pListeningAddr: NODE_B_P2P_ADDR,
      rpcListeningAddr: NODE_B_RPC_ADDR,
      databasePrefix: `/wasm-dual-node-b-${RUN_ID}`,
    },
  });

  try {
    // --- Start nodes ---
    log('Starting node A...', 'highlight');
    const infoA = await nodeA.start();
    await waitForNodeReady(nodeA, 'A');
    pass(`Node A started (pubkey=${infoA.pubkey})`);
    passed++;

    log('Starting node B...', 'highlight');
    const infoB = await nodeB.start();
    await waitForNodeReady(nodeB, 'B');
    pass(`Node B started (pubkey=${infoB.pubkey})`);
    passed++;

    // --- Funding check ---
    await checkFundingBalance(nodeA, 'A');
    passed++;
    await checkFundingBalance(nodeB, 'B');
    passed++;

    const peerIdA = await nodeIdToPeerId(infoA.pubkey);
    const peerIdB = await nodeIdToPeerId(infoB.pubkey);
    const multiaddrA = buildMultiaddr(NODE_A_P2P_ADDR, peerIdA);
    const multiaddrB = buildMultiaddr(NODE_B_P2P_ADDR, peerIdB);

    // --- Clean up any leftover channels from previous runs ---
    await closeAnyExistingChannels(nodeA, infoB.pubkey);
    pass('Pre-existing channels closed');
    passed++;

    // --- Connect peers ---
    log('Connecting peers...', 'highlight');
    await nodeA.connectPeer({ address: multiaddrB });
    await nodeB.connectPeer({ address: multiaddrA });
    pass('Peers connected');
    passed++;

    // --- Open channel ---
    log('Opening channel (A -> B)...', 'highlight');
    const openResult = await nodeA.openChannel({
      pubkey: infoB.pubkey,
      funding_amount: ckbToShannons(CHANNEL_FUNDING_CKB),
    });
    pass(`Channel opened (temporary_id=${openResult.temporary_channel_id})`);
    passed++;

    // --- Wait for ready ---
    log('Waiting for channel to become ready...', 'highlight');
    const readyChannel = await waitForChannelState(
      nodeA,
      infoB.pubkey,
      ChannelState.ChannelReady,
      CHANNEL_READY_TIMEOUT_MS,
    );
    const channelId = readyChannel.channel_id;
    pass(`Channel ready (id=${channelId})`);
    passed++;

    // --- Create invoice on B ---
    log('Creating invoice on node B...', 'highlight');
    const invoiceResult = await nodeB.newInvoice({
      amount: ckbToShannons(INVOICE_AMOUNT_CKB),
      currency: 'Fibt',
      description: 'wasm-dual-node-e2e',
    });
    pass(`Invoice created (${invoiceResult.invoice_address.slice(0, 24)}...)`);
    passed++;

    // --- Send payment from A ---
    log('Sending payment from A to B...', 'highlight');
    const paymentResult = await nodeA.sendPayment({
      invoice: invoiceResult.invoice_address,
    });
    pass(`Payment sent (hash=${paymentResult.payment_hash})`);
    passed++;

    log('Waiting for payment to complete...', 'highlight');
    const finalPayment = await nodeA.waitForPayment(paymentResult.payment_hash, {
      timeout: PAYMENT_TIMEOUT_MS,
    });
    if (finalPayment.status !== 'Success') {
      throw new Error(`Payment failed with status ${finalPayment.status}`);
    }
    pass(`Payment succeeded (status=${finalPayment.status})`);
    passed++;

    // --- Close channel ---
    log('Closing channel...', 'highlight');
    await nodeA.shutdownChannel({ channel_id: channelId });
    await waitForChannelState(nodeA, infoB.pubkey, ChannelState.Closed, CHANNEL_CLOSE_TIMEOUT_MS);
    await waitForChannelState(nodeB, infoA.pubkey, ChannelState.Closed, CHANNEL_CLOSE_TIMEOUT_MS);
    pass('Channel closed on both nodes');
    passed++;
  } catch (error) {
    failed++;
    fail('E2E flow', error);
  } finally {
    log('Stopping nodes...', 'highlight');
    await nodeA.stop().catch((err) => fail('Stop node A', err));
    await nodeB.stop().catch((err) => fail('Stop node B', err));
    pass('Nodes stopped');
  }

  printSummary(passed, failed);
}

runE2E().catch((error) => {
  fail('Unhandled error', error);
  printSummary(0, 1);
});
