#!/usr/bin/env node
/**
 * E2E testnet dual-node test — cross-platform Node.js rewrite.
 *
 * Lifecycle:
 *   1. (optional) pnpm build
 *   2. config init (with per-node rpc/p2p ports)
 *   3. binary download (or skip)
 *   4. start both nodes, wait for RPC ready
 *   5. (optional) faucet claim + CKB deposit
 *   6. peer connect → open channel → create invoice → send payment → close channel
 *   7. cleanup (stop nodes, collect artifacts)
 *
 * Environment variables (all optional, sensible defaults provided):
 *   ARTIFACT_DIR, WORK_ROOT,
 *   NODE_A_DIR, NODE_B_DIR,
 *   NODE_A_RPC_PORT, NODE_A_P2P_PORT, NODE_B_RPC_PORT, NODE_B_P2P_PORT,
 *   NETWORK, FIBER_KEY_PASSWORD,
 *   SOURCE_PRIVKEY, SOURCE_ADDRESS,
 *   CHANNEL_FUNDING_CKB, INVOICE_AMOUNT_CKB, DEPOSIT_AMOUNT_CKB,
 *   DEPOSIT_MAX_ATTEMPTS, DEPOSIT_RETRY_DELAY_SEC,
 *   NODE_READY_TIMEOUT_SEC, FUNDING_WAIT_TIMEOUT_SEC,
 *   CHANNEL_READY_TIMEOUT_SEC, PAYMENT_TIMEOUT_SEC, CLOSE_TIMEOUT_SEC,
 *   POLL_INTERVAL_SEC,
 *   SKIP_BUILD, SKIP_DEPOSIT, SKIP_BINARY_DOWNLOAD,
 *   FIBER_BINARY_VERSION
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const CLI_DIR = join(ROOT_DIR, 'packages', 'cli');
const CLI_ENTRY = join(CLI_DIR, 'dist', 'cli.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isWin = platform() === 'win32';

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function env(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v;
}

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return parseInt(v, 10);
}

function log(...args) {
  process.stderr.write(`[e2e-dual-node] ${args.join(' ')}\n`);
}

function fail(msg) {
  throw new Error(msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

/**
 * Retry a sync/async function up to `retries` times with a delay between attempts.
 */
async function retry(fn, { retries = 3, delaySec = 3, label = 'operation' } = {}) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      const result = await fn();
      return result;
    } catch (err) {
      lastErr = err;
      log(`${label}: attempt ${i}/${retries} failed — ${err.message?.split('\n')[0] ?? err}`);
      if (i < retries) {
        await sleep(delaySec * 1000);
      }
    }
  }
  fail(`${label}: all ${retries} attempts failed. Last error: ${lastErr?.message ?? lastErr}`);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ARTIFACT_DIR = env(
  'ARTIFACT_DIR',
  join(ROOT_DIR, '.artifacts', `e2e-testnet-dual-node-${timestamp()}`),
);
const WORK_ROOT = env('WORK_ROOT', join(ROOT_DIR, '.tmp', 'e2e-testnet-dual-node'));

const NODE_A_DIR = env('NODE_A_DIR', join(WORK_ROOT, 'node-a'));
const NODE_B_DIR = env('NODE_B_DIR', join(WORK_ROOT, 'node-b'));

const NODE_A_RPC_PORT = envInt('NODE_A_RPC_PORT', 8227);
const NODE_A_P2P_PORT = envInt('NODE_A_P2P_PORT', 8228);
const NODE_B_RPC_PORT = envInt('NODE_B_RPC_PORT', 8327);
const NODE_B_P2P_PORT = envInt('NODE_B_P2P_PORT', 8328);

const NETWORK = env('NETWORK', 'testnet');
const KEY_PASSWORD = env('FIBER_KEY_PASSWORD', 'fiber-pay-e2e-key');
const SOURCE_PRIVKEY = env(
  'SOURCE_PRIVKEY',
  '0x254d048481119a73458935d4cd942e09f5bc12b02b925e816626cafc7d23b7c4',
);
const SOURCE_ADDRESS = env(
  'SOURCE_ADDRESS',
  'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwwkx07pxk8g495z5u0j62pkucp5h2sjmszcrnx7',
);

const CHANNEL_FUNDING_CKB = envInt('CHANNEL_FUNDING_CKB', 200);
const INVOICE_AMOUNT_CKB = envInt('INVOICE_AMOUNT_CKB', 5);
const DEPOSIT_AMOUNT_CKB = envInt('DEPOSIT_AMOUNT_CKB', 250);
const DEPOSIT_MAX_ATTEMPTS = envInt('DEPOSIT_MAX_ATTEMPTS', 4);
const DEPOSIT_RETRY_DELAY_SEC = envInt('DEPOSIT_RETRY_DELAY_SEC', 20);

const NODE_READY_TIMEOUT_SEC = envInt('NODE_READY_TIMEOUT_SEC', 90);
const FUNDING_WAIT_TIMEOUT_SEC = envInt('FUNDING_WAIT_TIMEOUT_SEC', 600);
const CHANNEL_APPEAR_TIMEOUT_SEC = envInt('CHANNEL_APPEAR_TIMEOUT_SEC', 45);
const CHANNEL_READY_TIMEOUT_SEC = envInt('CHANNEL_READY_TIMEOUT_SEC', 600);
const PAYMENT_TIMEOUT_SEC = envInt('PAYMENT_TIMEOUT_SEC', 180);
const _CLOSE_TIMEOUT_SEC = envInt('CLOSE_TIMEOUT_SEC', 300);
const POLL_INTERVAL_SEC = envInt('POLL_INTERVAL_SEC', 5);

const SKIP_BUILD = env('SKIP_BUILD', '0') === '1';
const SKIP_DEPOSIT = env('SKIP_DEPOSIT', '0') === '1';
const SKIP_BINARY_DOWNLOAD = env('SKIP_BINARY_DOWNLOAD', '0') === '1';
const CLEAR_BEFORE_RUN = env('CLEAR_BEFORE_RUN', '1') === '1';
const FIBER_BINARY_VERSION = env('FIBER_BINARY_VERSION', 'v0.6.1');

const NODE_A_RPC_URL = `http://127.0.0.1:${NODE_A_RPC_PORT}`;
const NODE_B_RPC_URL = `http://127.0.0.1:${NODE_B_RPC_PORT}`;

const NODE_A_START_LOG = join(ARTIFACT_DIR, 'node-a.start.log');
const NODE_B_START_LOG = join(ARTIFACT_DIR, 'node-b.start.log');

// ---------------------------------------------------------------------------
// Cross-platform command helpers
// ---------------------------------------------------------------------------

/** Resolve the right command for the OS (adds .cmd on Windows for npm/pnpm). */
function resolveCmd(cmd) {
  if (isWin && ['pnpm', 'npx', 'npm', 'offckb'].includes(cmd)) {
    return `${cmd}.cmd`;
  }
  return cmd;
}

/**
 * Synchronous exec helper – returns stdout as a string.
 * On failure throws with detailed output unless `opts.ignoreError` is set.
 */
function run(cmd, args, opts = {}) {
  const { ignoreError = false, cwd = ROOT_DIR, envOverrides = {} } = opts;
  try {
    const result = execFileSync(resolveCmd(cmd), args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, ...envOverrides },
      stdio: ['pipe', 'pipe', 'pipe'],
      // On Windows, we need shell: true for .cmd files
      ...(isWin ? { shell: true } : {}),
    });
    return result;
  } catch (err) {
    if (ignoreError) return '';
    // Build a readable error that includes child process output
    const cmdStr = [cmd, ...args].join(' ');
    const childStdout = (err.stdout ?? '').trim();
    const childStderr = (err.stderr ?? '').trim();
    const details = [
      `Command failed (exit ${err.status ?? '?'}): ${cmdStr}`,
      childStderr && `  stderr: ${childStderr}`,
      childStdout && `  stdout: ${childStdout}`,
    ]
      .filter(Boolean)
      .join('\n');
    const wrapped = new Error(details);
    wrapped.exitCode = err.status;
    wrapped.childStdout = childStdout;
    wrapped.childStderr = childStderr;
    throw wrapped;
  }
}

/**
 * Run a command and return { stdout, stderr, exitCode }.
 * Never throws.
 */
function runSafe(cmd, args, opts = {}) {
  const { cwd = ROOT_DIR, envOverrides = {} } = opts;
  try {
    const stdout = execFileSync(resolveCmd(cmd), args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, ...envOverrides },
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(isWin ? { shell: true } : {}),
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

/**
 * Spawn a child process detached – returns the ChildProcess.
 * stdout + stderr are written to logPath.
 */
function spawnDetached(cmd, args, opts = {}) {
  const { cwd = ROOT_DIR, envOverrides = {}, logPath } = opts;
  ensureDir(dirname(logPath));
  const out = createWriteStream(logPath, { flags: 'w' });
  const child = spawn(resolveCmd(cmd), args, {
    cwd,
    env: { ...process.env, ...envOverrides },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !isWin,
    ...(isWin ? { shell: true } : {}),
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  return child;
}

// ---------------------------------------------------------------------------
// fiber-pay CLI wrappers
// ---------------------------------------------------------------------------

function fiberPayEnv(nodeName) {
  const dir = nodeName === 'A' ? NODE_A_DIR : NODE_B_DIR;
  const rpc = nodeName === 'A' ? NODE_A_RPC_URL : NODE_B_RPC_URL;
  const rpcPort = nodeName === 'A' ? NODE_A_RPC_PORT : NODE_B_RPC_PORT;
  const p2pPort = nodeName === 'A' ? NODE_A_P2P_PORT : NODE_B_P2P_PORT;
  return {
    FIBER_DATA_DIR: dir,
    FIBER_RPC_URL: rpc,
    FIBER_RPC_PORT: String(rpcPort),
    FIBER_P2P_PORT: String(p2pPort),
    FIBER_NETWORK: NETWORK,
    FIBER_KEY_PASSWORD: KEY_PASSWORD,
  };
}

function fiberPay(nodeName, ...args) {
  return run('pnpm', ['--filter', '@fiber-pay/cli', 'exec', 'node', CLI_ENTRY, ...args], {
    envOverrides: fiberPayEnv(nodeName),
  });
}

function fiberPaySafe(nodeName, ...args) {
  return runSafe('pnpm', ['--filter', '@fiber-pay/cli', 'exec', 'node', CLI_ENTRY, ...args], {
    envOverrides: fiberPayEnv(nodeName),
  });
}

function fiberPaySpawn(nodeName, args, logPath) {
  return spawnDetached('pnpm', ['--filter', '@fiber-pay/cli', 'exec', 'node', CLI_ENTRY, ...args], {
    envOverrides: fiberPayEnv(nodeName),
    logPath,
  });
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function jsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

function jsonGet(obj, path) {
  if (!obj) return undefined;
  const tokens = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = cur[t];
  }
  return cur;
}

function hexToBigInt(value) {
  if (typeof value !== 'string') return undefined;
  if (value.startsWith('0x') || value.startsWith('0X')) {
    return BigInt(value);
  }
  if (/^\d+$/.test(value)) {
    return BigInt(value);
  }
  return undefined;
}

function shannonsToCkb(shannons) {
  return Number(shannons) / 100_000_000;
}

async function fetchNodeInfoRaw(rpcUrl) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'node_info', params: [] }),
  });

  if (!response.ok) {
    fail(`node_info RPC failed at ${rpcUrl} with HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    fail(`node_info RPC error at ${rpcUrl}: ${JSON.stringify(payload.error)}`);
  }
  if (!payload?.result) {
    fail(`node_info RPC returned no result at ${rpcUrl}`);
  }

  return payload.result;
}

function _firstMultiaddr(infoObj) {
  const addresses = jsonGet(infoObj, 'data.addresses');
  if (!Array.isArray(addresses) || addresses.length === 0) return undefined;
  const first = addresses[0];
  if (typeof first === 'string') return first;
  if (first && typeof first.address === 'string') return first.address;
  return undefined;
}

// ---------------------------------------------------------------------------
// Hex compressed pubkey → libp2p peer ID (base58btc)
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncode(buf) {
  let num = BigInt(`0x${Buffer.from(buf).toString('hex')}`);
  let str = '';
  while (num > 0n) {
    str = BASE58_ALPHABET[Number(num % 58n)] + str;
    num = num / 58n;
  }
  // Preserve leading zeros
  for (let i = 0; i < buf.length && buf[i] === 0; i++) {
    str = `1${str}`;
  }
  return str;
}

/**
 * Convert a hex-encoded secp256k1 compressed public key (33 bytes)
 * to a libp2p peer ID (base58btc-encoded SHA256 multihash of raw key bytes).
 */
function hexPubkeyToPeerId(hexPubkey) {
  const raw = Buffer.from(hexPubkey.replace(/^0x/, ''), 'hex');
  if (raw.length !== 33) {
    fail(`Expected 33-byte compressed pubkey, got ${raw.length} bytes`);
  }
  // SHA256 multihash: 0x12 (sha2-256) + 0x20 (32 bytes) + sha256(raw compressed pubkey)
  const sha = createHash('sha256').update(raw).digest();
  const mh = Buffer.concat([Buffer.from([0x12, 0x20]), sha]);
  return base58btcEncode(mh);
}

// ---------------------------------------------------------------------------
// Polling helpers
// ---------------------------------------------------------------------------

async function waitForNodeReady(nodeName, timeoutSec) {
  const start = nowSec();
  while (true) {
    const { stdout } = fiberPaySafe(nodeName, 'node', 'info', '--json');
    const parsed = jsonParse(stdout);
    if (parsed && jsonGet(parsed, 'success') === true) {
      log(`Node ${nodeName} is ready`);
      return parsed;
    }
    if (nowSec() - start >= timeoutSec) {
      fail(`Node ${nodeName} not ready within ${timeoutSec}s`);
    }
    await sleep(POLL_INTERVAL_SEC * 1000);
  }
}

function matchChannelByPeer(channel, peerSelectors) {
  if (!channel || typeof channel !== 'object') return false;
  const peerId = channel.peer_id;
  if (typeof peerId !== 'string') return false;
  return peerSelectors.includes(peerId);
}

function findChannel(channels, peerSelectors, stateName) {
  if (!Array.isArray(channels) || channels.length === 0) return undefined;

  const matched = channels.find((ch) => {
    if (stateName && ch?.state?.state_name !== stateName) return false;
    return matchChannelByPeer(ch, peerSelectors);
  });
  if (matched) return matched;

  if (channels.length === 1) {
    const only = channels[0];
    if (!stateName || only?.state?.state_name === stateName) {
      return only;
    }
  }

  return undefined;
}

async function waitForChannelReady(peerSelectors, timeoutSec) {
  const start = nowSec();
  let lastRaw = '';
  let lastParsed;
  while (true) {
    const { stdout } = fiberPaySafe('A', 'channel', 'list', '--state', 'CHANNEL_READY', '--json');
    lastRaw = stdout;
    const parsed = jsonParse(stdout);
    lastParsed = parsed;
    if (parsed) {
      const channels = jsonGet(parsed, 'data.channels');
      const readyChannel = findChannel(channels, peerSelectors, 'ChannelReady');
      if (readyChannel?.channel_id) {
        return readyChannel.channel_id;
      }
    }
    if (nowSec() - start >= timeoutSec) {
      writeArtifact('wait-channel-ready.last.raw.txt', lastRaw);
      writeArtifact('wait-channel-ready.last.parsed.json', {
        peerSelectors,
        timeoutSec,
        parsed: lastParsed ?? null,
      });
      fail(
        `Channel did not reach ChannelReady within ${timeoutSec}s (peer selectors=${peerSelectors.join(',')})`,
      );
    }
    await sleep(POLL_INTERVAL_SEC * 1000);
  }
}

async function waitForChannelAppear(peerSelectors, timeoutSec) {
  const start = nowSec();
  let lastRaw = '';
  let lastParsed;
  while (true) {
    const { stdout } = fiberPaySafe('A', 'channel', 'list', '--include-closed', '--json');
    lastRaw = stdout;
    const parsed = jsonParse(stdout);
    lastParsed = parsed;
    if (parsed) {
      const channels = jsonGet(parsed, 'data.channels');
      const appearedChannel = findChannel(channels, peerSelectors);
      if (appearedChannel?.channel_id) {
        return appearedChannel.channel_id;
      }
    }

    if (nowSec() - start >= timeoutSec) {
      writeArtifact('wait-channel-appear.last.raw.txt', lastRaw);
      writeArtifact('wait-channel-appear.last.parsed.json', {
        peerSelectors,
        timeoutSec,
        parsed: lastParsed ?? null,
      });
      fail(
        `Channel did not appear after open within ${timeoutSec}s (peer selectors=${peerSelectors.join(',')})`,
      );
    }
    await sleep(POLL_INTERVAL_SEC * 1000);
  }
}

async function waitForPeerConnected(peerId, timeoutSec) {
  const start = nowSec();
  while (true) {
    const { stdout } = fiberPaySafe('A', 'peer', 'list', '--json');
    const parsed = jsonParse(stdout);
    if (parsed) {
      const peers = jsonGet(parsed, 'data.peers');
      if (Array.isArray(peers)) {
        const found = peers.some((peer) => peer?.peer_id === peerId);
        if (found) {
          log(`Peer connected: ${peerId}`);
          return;
        }
      }
    }

    if (nowSec() - start >= timeoutSec) {
      fail(`Peer ${peerId} not connected within ${timeoutSec}s`);
    }
    await sleep(POLL_INTERVAL_SEC * 1000);
  }
}

async function waitForPaymentTerminal(paymentHash, timeoutSec) {
  const start = nowSec();
  while (true) {
    const { stdout } = fiberPaySafe('A', 'payment', 'get', paymentHash, '--json');
    const parsed = jsonParse(stdout);
    if (parsed) {
      const status = jsonGet(parsed, 'data.status');
      if (status === 'Success' || status === 'success') {
        log('Payment reached Success');
        return;
      }
      if (status === 'Failed' || status === 'failed') {
        const reason = jsonGet(parsed, 'data.failureReason') ?? 'unknown';
        fail(`Payment failed: ${reason}`);
      }
    }
    if (nowSec() - start >= timeoutSec) {
      fail(`Payment not terminal within ${timeoutSec}s`);
    }
    await sleep(POLL_INTERVAL_SEC * 1000);
  }
}

// ---------------------------------------------------------------------------
// Deposit / faucet helpers
// ---------------------------------------------------------------------------

async function depositWithRetry(nodeName, fundingAddr, amountCkb, logPath, sourcePrivkey) {
  ensureDir(dirname(logPath));
  let logContent = '';
  const appendLog = (s) => {
    logContent += `${s}\n`;
  };

  for (let attempt = 1; attempt <= DEPOSIT_MAX_ATTEMPTS; attempt++) {
    log(`Transferring funds to Node ${nodeName} (attempt ${attempt}/${DEPOSIT_MAX_ATTEMPTS})`);

    appendLog(`=== funding attempt ${attempt}/${DEPOSIT_MAX_ATTEMPTS} node=${nodeName} ===`);
    appendLog(`timestamp: ${new Date().toISOString()}`);
    if (fundingAddr) appendLog(`address: ${fundingAddr}`);
    if (amountCkb) appendLog(`amount_ckb: ${amountCkb}`);
    appendLog('');

    if (!sourcePrivkey) {
      appendLog(`Missing source private key for transfer node=${nodeName}.`);
      writeFileSync(logPath, logContent, 'utf-8');
      fail(`Missing source private key for transfer node=${nodeName}`);
    }

    const { stdout, stderr, exitCode } = runSafe('offckb', [
      'transfer',
      '--network',
      NETWORK,
      '--privkey',
      sourcePrivkey,
      fundingAddr,
      String(amountCkb),
    ]);
    appendLog(`${stdout}\n${stderr}`);

    if (exitCode === 0) {
      log(`Transfer submitted for Node ${nodeName}`);
      writeFileSync(logPath, logContent, 'utf-8');
      return;
    }

    if (attempt < DEPOSIT_MAX_ATTEMPTS) {
      log(
        `Funding attempt ${attempt} failed (node=${nodeName}); retrying in ${DEPOSIT_RETRY_DELAY_SEC}s`,
      );
      await sleep(DEPOSIT_RETRY_DELAY_SEC * 1000);
    }
  }

  writeFileSync(logPath, logContent, 'utf-8');
  log(`ERROR: Transfer to Node ${nodeName} failed after ${DEPOSIT_MAX_ATTEMPTS} attempts.`);
  log(`ERROR: Check transfer logs: ${logPath}`);
  fail(`Deposit failed for node=${nodeName}`);
}

function getBalanceCkb(address) {
  const { stdout, stderr } = runSafe('offckb', ['balance', '--network', NETWORK, address]);
  const combined = `${stdout}\n${stderr}`;
  const match = combined.match(/Balance:\s*([0-9][0-9.]*)\s*CKB/);
  return match ? parseFloat(match[1]) : undefined;
}

async function waitForBalanceAtLeast(nodeName, address, expectedCkb, timeoutSec) {
  const start = nowSec();
  while (true) {
    const balance = getBalanceCkb(address);
    if (balance !== undefined && balance >= expectedCkb) {
      log(`Node ${nodeName} funding balance reached ${balance} CKB`);
      return;
    }
    if (nowSec() - start >= timeoutSec) {
      fail(
        `Node ${nodeName} funding balance did not reach ${expectedCkb} CKB within ${timeoutSec}s`,
      );
    }
    await sleep(POLL_INTERVAL_SEC * 1000);
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** @type {import('node:child_process').ChildProcess | null} */
let nodeAChild = null;
/** @type {import('node:child_process').ChildProcess | null} */
let nodeBChild = null;

function collectArtifacts() {
  ensureDir(ARTIFACT_DIR);
  const nodeAConfig = join(NODE_A_DIR, 'config.yml');
  const nodeBConfig = join(NODE_B_DIR, 'config.yml');
  if (existsSync(nodeAConfig)) copyFileSync(nodeAConfig, join(ARTIFACT_DIR, 'node-a.config.yml'));
  if (existsSync(nodeBConfig)) copyFileSync(nodeBConfig, join(ARTIFACT_DIR, 'node-b.config.yml'));
}

function stopNodes() {
  fiberPaySafe('A', 'node', 'stop');
  fiberPaySafe('B', 'node', 'stop');

  if (nodeAChild && !nodeAChild.killed) {
    try {
      nodeAChild.kill();
    } catch {}
  }
  if (nodeBChild && !nodeBChild.killed) {
    try {
      nodeBChild.kill();
    } catch {}
  }
}

function cleanup(exitCode) {
  log(`Collecting artifacts into ${ARTIFACT_DIR}`);
  try {
    collectArtifacts();
  } catch {}
  try {
    stopNodes();
  } catch {}
  if (exitCode !== 0) {
    log(`FAILED (exit code ${exitCode}). See artifacts: ${ARTIFACT_DIR}`);
  } else {
    log(`SUCCESS. Artifacts: ${ARTIFACT_DIR}`);
  }
}

function clearTestWorkspace() {
  log(`Clearing previous workspace at ${WORK_ROOT}`);
  try {
    fiberPaySafe('A', 'node', 'stop');
  } catch {}
  try {
    fiberPaySafe('B', 'node', 'stop');
  } catch {}
  try {
    rmSync(WORK_ROOT, { recursive: true, force: true });
  } catch {}
}

// ---------------------------------------------------------------------------
// Write artifact helper
// ---------------------------------------------------------------------------

function writeArtifact(name, content) {
  const filePath = join(ARTIFACT_DIR, name);
  writeFileSync(
    filePath,
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  ensureDir(ARTIFACT_DIR);

  if (CLEAR_BEFORE_RUN) {
    clearTestWorkspace();
  }

  ensureDir(NODE_A_DIR);
  ensureDir(NODE_B_DIR);

  // Check required commands
  for (const cmd of ['pnpm', 'node']) {
    try {
      execFileSync(isWin ? 'where' : 'which', [cmd], { stdio: 'pipe' });
    } catch {
      fail(`Required command not found: ${cmd}`);
    }
  }

  if (!SKIP_DEPOSIT) {
    try {
      execFileSync(isWin ? 'where' : 'which', ['offckb'], { stdio: 'pipe' });
    } catch {
      fail('Required command not found: offckb (needed for deposit). Set SKIP_DEPOSIT=1 to skip.');
    }
  }

  // ---- Build ----
  if (!SKIP_BUILD) {
    log('Preparing CLI (pnpm build)');
    run('pnpm', ['build']);
  }

  // ---- Config init ----
  log('Initializing configs');
  const configInitA = fiberPay('A', 'config', 'init', '--network', NETWORK, '--force', '--json');
  writeArtifact('node-a.config-init.json', configInitA);
  const configInitB = fiberPay('B', 'config', 'init', '--network', NETWORK, '--force', '--json');
  writeArtifact('node-b.config-init.json', configInitB);

  // ---- Binary download ----
  if (!SKIP_BINARY_DOWNLOAD) {
    log(`Ensuring fnn binaries (version=${FIBER_BINARY_VERSION})`);
    const binA = fiberPay('A', 'binary', 'download', '--version', FIBER_BINARY_VERSION, '--json');
    writeArtifact('node-a.binary.json', binA);
    const binB = fiberPay('B', 'binary', 'download', '--version', FIBER_BINARY_VERSION, '--json');
    writeArtifact('node-b.binary.json', binB);
  } else {
    log('Skipping binary download (SKIP_BINARY_DOWNLOAD=1), checking existing binaries');
    const infoA = fiberPay('A', 'binary', 'info', '--json');
    writeArtifact('node-a.binary-info.json', infoA);
    const infoB = fiberPay('B', 'binary', 'info', '--json');
    writeArtifact('node-b.binary-info.json', infoB);
  }

  // ---- Start nodes ----
  log(`Starting Node A (rpc=${NODE_A_RPC_PORT}, p2p=${NODE_A_P2P_PORT})`);
  nodeAChild = fiberPaySpawn('A', ['node', 'start'], NODE_A_START_LOG);

  log(`Starting Node B (rpc=${NODE_B_RPC_PORT}, p2p=${NODE_B_P2P_PORT})`);
  nodeBChild = fiberPaySpawn('B', ['node', 'start'], NODE_B_START_LOG);

  // ---- Wait for ready ----
  await waitForNodeReady('A', NODE_READY_TIMEOUT_SEC);
  await waitForNodeReady('B', NODE_READY_TIMEOUT_SEC);

  // ---- Collect node info ----
  const nodeAInfoRaw = fiberPay('A', 'node', 'info', '--json');
  const nodeBInfoRaw = fiberPay('B', 'node', 'info', '--json');
  writeArtifact('node-a.info.json', nodeAInfoRaw);
  writeArtifact('node-b.info.json', nodeBInfoRaw);

  const nodeAInfo = jsonParse(nodeAInfoRaw);
  const nodeBInfo = jsonParse(nodeBInfoRaw);
  if (!nodeAInfo || !nodeBInfo) fail('Failed to parse node info');

  const nodeAHexId = jsonGet(nodeAInfo, 'data.nodeId');
  const nodeBHexId = jsonGet(nodeBInfo, 'data.nodeId');
  const nodeAFundingAddr = jsonGet(nodeAInfo, 'data.fundingAddress');
  const nodeBFundingAddr = jsonGet(nodeBInfo, 'data.fundingAddress');

  if (typeof nodeAHexId !== 'string' || typeof nodeBHexId !== 'string') {
    fail('Failed to extract node hex IDs from node info');
  }

  const nodeBRawInfo = await fetchNodeInfoRaw(NODE_B_RPC_URL);
  const minAutoAcceptHex = nodeBRawInfo.open_channel_auto_accept_min_ckb_funding_amount;
  const minAutoAcceptShannons = hexToBigInt(minAutoAcceptHex);
  if (minAutoAcceptShannons === undefined) {
    fail(`Invalid open_channel_auto_accept_min_ckb_funding_amount: ${String(minAutoAcceptHex)}`);
  }
  const channelFundingShannons = BigInt(CHANNEL_FUNDING_CKB) * 100_000_000n;
  if (channelFundingShannons < minAutoAcceptShannons) {
    fail(
      `CHANNEL_FUNDING_CKB (${CHANNEL_FUNDING_CKB}) is below Node B auto-accept minimum ` +
        `(${shannonsToCkb(minAutoAcceptShannons)} CKB). Increase CHANNEL_FUNDING_CKB or adjust node config.`,
    );
  }
  log(
    `Node B auto-accept minimum: ${shannonsToCkb(minAutoAcceptShannons)} CKB; ` +
      `requested funding: ${CHANNEL_FUNDING_CKB} CKB`,
  );

  // Convert hex pubkeys to libp2p peer IDs (base58btc)
  const nodeAPeerId = hexPubkeyToPeerId(nodeAHexId);
  const nodeBPeerId = hexPubkeyToPeerId(nodeBHexId);

  // Build multiaddr for Node B from local P2P port + derived peer ID.
  // We intentionally avoid relying on node_info.addresses because it can be empty.
  const nodeBMultiaddr = `/ip4/127.0.0.1/tcp/${NODE_B_P2P_PORT}/p2p/${nodeBPeerId}`;

  log(`Node A: ${nodeAHexId} (peer: ${nodeAPeerId})`);
  log(`Node B: ${nodeBHexId} (peer: ${nodeBPeerId})`);

  // ---- Deposit ----
  if (!SKIP_DEPOSIT) {
    log(
      `Funding via fixed source account transfer (retries=${DEPOSIT_MAX_ATTEMPTS}, delay=${DEPOSIT_RETRY_DELAY_SEC}s)`,
    );
    log(`Source account: ${SOURCE_ADDRESS}`);

    const sourceBalance = getBalanceCkb(SOURCE_ADDRESS);
    const requiredBalance = DEPOSIT_AMOUNT_CKB * 2;
    if (sourceBalance === undefined) {
      fail(`Unable to read source account balance: ${SOURCE_ADDRESS}`);
    }
    log(`Source balance: ${sourceBalance} CKB, required minimum: ${requiredBalance} CKB`);
    if (sourceBalance < requiredBalance) {
      fail(
        `Insufficient source balance (${sourceBalance} CKB). Need at least ${requiredBalance} CKB to fund both nodes.`,
      );
    }

    await depositWithRetry(
      'A',
      nodeAFundingAddr,
      DEPOSIT_AMOUNT_CKB,
      join(ARTIFACT_DIR, 'deposit-node-a.log'),
      SOURCE_PRIVKEY,
    );
    await depositWithRetry(
      'B',
      nodeBFundingAddr,
      DEPOSIT_AMOUNT_CKB,
      join(ARTIFACT_DIR, 'deposit-node-b.log'),
      SOURCE_PRIVKEY,
    );

    log(`Polling funding balances (timeout=${FUNDING_WAIT_TIMEOUT_SEC}s)`);
    await waitForBalanceAtLeast(
      'A',
      nodeAFundingAddr,
      DEPOSIT_AMOUNT_CKB,
      FUNDING_WAIT_TIMEOUT_SEC,
    );
    await waitForBalanceAtLeast(
      'B',
      nodeBFundingAddr,
      DEPOSIT_AMOUNT_CKB,
      FUNDING_WAIT_TIMEOUT_SEC,
    );
  } else {
    log('Skipping deposit step (SKIP_DEPOSIT=1)');
  }

  // ---- Peer connect (with retry — can fail right after node startup) ----
  log('Connecting Node A to Node B');
  const connectResult = await retry(
    () => fiberPay('A', 'peer', 'connect', nodeBMultiaddr, '--json'),
    { retries: 5, delaySec: 3, label: 'peer connect' },
  );
  writeArtifact('peer-connect.json', connectResult);

  await waitForPeerConnected(nodeBPeerId, 60);

  // ---- Open channel (with retry — peer Init message may still be in flight) ----
  log(`Opening channel from A to B (funding=${CHANNEL_FUNDING_CKB} CKB)`);
  const openRaw = await retry(
    () =>
      fiberPay(
        'A',
        'channel',
        'open',
        '--peer',
        nodeBPeerId,
        '--funding',
        String(CHANNEL_FUNDING_CKB),
        '--json',
      ),
    { retries: 10, delaySec: 5, label: 'channel open' },
  );
  writeArtifact('channel-open.json', openRaw);

  const openJson = jsonParse(openRaw);
  const tempChannelId = jsonGet(openJson, 'data.temporaryChannelId');
  log(`Temporary channel id: ${tempChannelId}`);

  const peerSelectors = [nodeBHexId, nodeBPeerId];
  const appearedChannelId = await waitForChannelAppear(peerSelectors, CHANNEL_APPEAR_TIMEOUT_SEC);
  log(`Channel appeared: ${appearedChannelId}`);

  // ---- Wait for channel ready ----
  const channelId = await waitForChannelReady(peerSelectors, CHANNEL_READY_TIMEOUT_SEC);
  log(`Channel ready: ${channelId}`);
  writeArtifact('channel-id.txt', channelId);

  // ---- Create invoice on Node B ----
  log(`Creating invoice on Node B (amount=${INVOICE_AMOUNT_CKB} CKB)`);
  const invoiceRaw = fiberPay(
    'B',
    'invoice',
    'create',
    '--amount',
    String(INVOICE_AMOUNT_CKB),
    '--description',
    'ci-dual-node-e2e',
    '--json',
  );
  writeArtifact('invoice-create.json', invoiceRaw);

  const invoiceJson = jsonParse(invoiceRaw);
  const invoiceStr = jsonGet(invoiceJson, 'data.invoice');
  if (!invoiceStr) fail('Failed to extract invoice string');

  // ---- Send payment ----
  log('Sending payment from Node A');
  const sendRaw = fiberPay('A', 'payment', 'send', invoiceStr, '--json');
  writeArtifact('payment-send.json', sendRaw);

  const sendJson = jsonParse(sendRaw);
  const paymentHash = jsonGet(sendJson, 'data.paymentHash');
  if (!paymentHash) fail('Failed to extract paymentHash');

  // ---- Wait for payment ----
  await waitForPaymentTerminal(paymentHash, PAYMENT_TIMEOUT_SEC);
  const paymentFinal = fiberPay('A', 'payment', 'get', paymentHash, '--json');
  writeArtifact('payment-final.json', paymentFinal);

  // ---- Close channel ----
  log('Closing channel');
  const closeResult = fiberPay('A', 'channel', 'close', channelId, '--json');
  writeArtifact('channel-close.json', closeResult);
  log('Channel close command accepted; skipping close-state wait and continuing cleanup');

  log('E2E flow completed');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main()
  .then(() => {
    cleanup(0);
    process.exit(0);
  })
  .catch((err) => {
    log(`Unhandled error: ${err.message || err}`);
    if (err.stack) log(err.stack);
    cleanup(1);
    process.exit(1);
  });

// Handle SIGINT / SIGTERM
process.on('SIGINT', () => {
  cleanup(130);
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup(143);
  process.exit(143);
});
