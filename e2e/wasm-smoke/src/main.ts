/**
 * Fiber WASM Browser Smoke Test
 *
 * Tests the full stack:
 * 1. Import @nervosnetwork/fiber-js
 * 2. Import fiber-pay SDK browser module
 * 3. Create credential provider
 * 4. Build config
 * 5. Start WASM node
 * 6. Call node_info
 * 7. Stop node
 */

// Direct imports from source (Vite resolves TypeScript)
import { ConfigBuilder } from '@sdk/browser/config-builder';
import { RawKeyCredentialProvider } from '@sdk/browser/raw-key-credential-provider';
import { FiberWasmAdapter } from '@sdk/browser/wasm-adapter';
import type { FiberWasmInstance } from '@sdk/browser/wasm-adapter';

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

function pass(label: string) { log(`✅ PASS: ${label}`, 'ok'); }
function fail(label: string, err: unknown) { log(`❌ FAIL: ${label}: ${err}`, 'err'); }

// =============================================================================
// Smoke Tests
// =============================================================================

async function runSmokeTests() {
  log('=== Fiber WASM Smoke Test ===', 'highlight');
  let totalPass = 0;
  let totalFail = 0;

  // --- Test 1: Import fiber-js ---
  let FiberClass: any;
  try {
    const mod = await import('@nervosnetwork/fiber-js');
    FiberClass = mod.Fiber ?? mod.default?.Fiber ?? mod.default;
    if (!FiberClass) throw new Error('Fiber class not found in module');
    pass('Import @nervosnetwork/fiber-js');
    totalPass++;
  } catch (e) {
    fail('Import @nervosnetwork/fiber-js', e);
    totalFail++;
    log('Cannot proceed without fiber-js. Aborting.', 'err');
    return;
  }

  // --- Test 2: ConfigBuilder ---
  let configYaml: string;
  try {
    configYaml = ConfigBuilder.build({ network: 'testnet' });
    if (!configYaml.includes('testnet') || !configYaml.includes('FundingLock')) {
      throw new Error('Config missing expected content');
    }
    pass('ConfigBuilder.build(testnet)');
    log(`  Config length: ${configYaml.length} chars`, 'info');
    totalPass++;
  } catch (e) {
    fail('ConfigBuilder.build', e);
    totalFail++;
    return;
  }

  // --- Test 3: Credential Provider ---
  let fiberKey: Uint8Array;
  let ckbKey: Uint8Array;
  try {
    fiberKey = new Uint8Array(32);
    crypto.getRandomValues(fiberKey);
    ckbKey = new Uint8Array(32);
    crypto.getRandomValues(ckbKey);

    const cred = new RawKeyCredentialProvider(fiberKey, ckbKey, 'smoke-test');
    if (!cred.isUnlocked()) throw new Error('Should be unlocked');
    const fk = await cred.getFiberKeyPair();
    if (fk.length !== 32) throw new Error('Key length mismatch');
    pass('RawKeyCredentialProvider');
    totalPass++;
  } catch (e) {
    fail('RawKeyCredentialProvider', e);
    totalFail++;
    return;
  }

  // --- Test 4: WASM Adapter + Start Node ---
  let adapter: FiberWasmAdapter;
  try {
    log('Starting WASM Fiber node (this may take 10-30s)...', 'highlight');

    adapter = new FiberWasmAdapter({
      factory: () => new FiberClass() as FiberWasmInstance,
    });

    adapter.on('stateChange', (state) => {
      log(`  Adapter state: ${state}`, 'info');
    });

    const startTime = Date.now();
    await adapter.start({
      config: configYaml!,
      fiberKeyPair: fiberKey!,
      ckbSecretKey: ckbKey!,
      logLevel: 'info',
      databasePrefix: `/wasm-smoke-${Date.now()}`,
    });
    const elapsed = Date.now() - startTime;

    if (adapter.state !== 'running') throw new Error(`Expected running, got ${adapter.state}`);
    pass(`WASM node started (${elapsed}ms)`);
    totalPass++;
  } catch (e) {
    fail('WASM node start', e);
    totalFail++;
    log('Node failed to start. Remaining tests skipped.', 'err');
    printSummary(totalPass, totalFail);
    return;
  }

  // --- Test 5: node_info ---
  try {
    const info = await adapter!.nodeInfo();
    const nodeIdentity = (info as { pubkey?: string; node_id?: string }).pubkey
      ?? (info as { pubkey?: string; node_id?: string }).node_id;
    if (!nodeIdentity) throw new Error('pubkey/node_id missing');
    pass('node_info');
    log(`  Node Pubkey: ${nodeIdentity}`, 'info');
    log(`  Version: ${info.version}`, 'info');
    log(`  Chain:   ${info.chain_hash}`, 'info');
    totalPass++;
  } catch (e) {
    fail('node_info', e);
    totalFail++;
  }

  // --- Test 6: list_peers (should be empty initially) ---
  try {
    const peers = await adapter!.listPeers();
    pass(`list_peers (${peers.peers?.length ?? 0} peers)`);
    totalPass++;
  } catch (e) {
    fail('list_peers', e);
    totalFail++;
  }

  // --- Test 7: list_channels ---
  try {
    const channels = await adapter!.listChannels();
    pass(`list_channels (${channels.channels?.length ?? 0} channels)`);
    totalPass++;
  } catch (e) {
    fail('list_channels', e);
    totalFail++;
  }

  // --- Test 8: Stop node ---
  try {
    await adapter!.stop();
    if (adapter!.state !== 'stopped') throw new Error(`Expected stopped, got ${adapter!.state}`);
    pass('Node stopped');
    totalPass++;
  } catch (e) {
    fail('Node stop', e);
    totalFail++;
  }

  printSummary(totalPass, totalFail);
}

function printSummary(passed: number, failed: number) {
  log('', 'info');
  log(`=== Summary: ${passed} passed, ${failed} failed ===`, failed > 0 ? 'err' : 'ok');

  // Set document title for headless browser detection
  document.title = failed > 0
    ? `FAIL: ${passed} passed, ${failed} failed`
    : `PASS: ${passed} passed, ${failed} failed`;
}

// Run
runSmokeTests().catch((e) => {
  fail('Unhandled error', e);
});
