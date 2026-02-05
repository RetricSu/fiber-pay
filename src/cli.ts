/**
 * fiber-pay CLI
 * Command-line interface for AI agents to manage CKB Lightning payments
 */

import { parseArgs } from 'util';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { FiberPay, createFiberPay, MCP_TOOLS, downloadFiberBinary, getFiberBinaryInfo, FiberRpcClient, ckbToShannons, shannonsToCkb, randomBytes32, toHex } from './index.js';
import type { McpToolName } from './agent/mcp-tools.js';
import type { DownloadProgress } from './binary/index.js';
import type { HexString } from './types/index.js';

// =============================================================================
// CLI Configuration
// =============================================================================

interface CliConfig {
  binaryPath?: string;
  dataDir: string;
  network: 'testnet' | 'mainnet';
  rpcUrl?: string;
  keyPassword?: string;
}

function getConfig(): CliConfig {
  return {
    binaryPath: process.env.FIBER_BINARY_PATH,
    dataDir: process.env.FIBER_DATA_DIR || `${process.env.HOME}/.fiber-pay`,
    network: (process.env.FIBER_NETWORK as 'testnet' | 'mainnet') || 'testnet',
    rpcUrl: process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227',
    keyPassword: process.env.FIBER_KEY_PASSWORD,
  };
}

// =============================================================================
// PID File Management
// =============================================================================

function getPidFilePath(dataDir: string): string {
  return join(dataDir, 'fiber.pid');
}

function writePidFile(dataDir: string, pid: number): void {
  writeFileSync(getPidFilePath(dataDir), String(pid));
}

function readPidFile(dataDir: string): number | null {
  const pidPath = getPidFilePath(dataDir);
  if (!existsSync(pidPath)) {
    return null;
  }
  try {
    return parseInt(readFileSync(pidPath, 'utf-8').trim());
  } catch {
    return null;
  }
}

function removePidFile(dataDir: string): void {
  const pidPath = getPidFilePath(dataDir);
  if (existsSync(pidPath)) {
    unlinkSync(pidPath);
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// CKB Address Encoding (Bech32m)
// =============================================================================

// Bech32m charset
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32mPolymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GEN[i];
      }
    }
  }
  return chk;
}

function bech32mHrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >> 5);
  }
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31);
  }
  return ret;
}

function bech32mCreateChecksum(hrp: string, data: number[]): number[] {
  const values = bech32mHrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const polymod = bech32mPolymod(values) ^ 0x2bc830a3; // Bech32m constant
  const ret: number[] = [];
  for (let i = 0; i < 6; i++) {
    ret.push((polymod >> (5 * (5 - i))) & 31);
  }
  return ret;
}

function convertBits(data: Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  
  if (pad && bits > 0) {
    ret.push((acc << (toBits - bits)) & maxv);
  }
  
  return ret;
}

function bech32mEncode(hrp: string, data: number[]): string {
  const checksum = bech32mCreateChecksum(hrp, data);
  const combined = data.concat(checksum);
  let result = hrp + '1';
  for (const d of combined) {
    result += BECH32_CHARSET[d];
  }
  return result;
}

interface Script {
  code_hash: string;
  hash_type: 'type' | 'data' | 'data1' | 'data2';
  args: string;
}

function scriptToAddress(script: Script, network: 'testnet' | 'mainnet'): string {
  const hrp = network === 'mainnet' ? 'ckb' : 'ckt';
  
  // CKB full address format (2021)
  // Format: 0x00 | code_hash | hash_type | args
  const hashTypeByte = script.hash_type === 'type' ? 0x01 
    : script.hash_type === 'data' ? 0x00 
    : script.hash_type === 'data1' ? 0x02
    : 0x04; // data2
  
  const codeHash = script.code_hash.startsWith('0x') 
    ? script.code_hash.slice(2) 
    : script.code_hash;
  const args = script.args.startsWith('0x') 
    ? script.args.slice(2) 
    : script.args;
  
  // Construct the payload: format_type(0x00) + code_hash(32) + hash_type(1) + args
  const payload = new Uint8Array(1 + 32 + 1 + args.length / 2);
  payload[0] = 0x00; // Full format type
  
  // code_hash
  for (let i = 0; i < 32; i++) {
    payload[1 + i] = parseInt(codeHash.slice(i * 2, i * 2 + 2), 16);
  }
  
  // hash_type
  payload[33] = hashTypeByte;
  
  // args
  for (let i = 0; i < args.length / 2; i++) {
    payload[34 + i] = parseInt(args.slice(i * 2, i * 2 + 2), 16);
  }
  
  // Convert to 5-bit groups and encode with bech32m
  const data = convertBits(payload, 8, 5, true);
  return bech32mEncode(hrp, data);
}

// =============================================================================
// Download Progress Display
// =============================================================================

function showProgress(progress: DownloadProgress): void {
  const percent = progress.percent !== undefined ? ` (${progress.percent}%)` : '';
  process.stdout.write(`\r[${progress.phase}]${percent} ${progress.message}`.padEnd(80));
  if (progress.phase === 'installing') {
    console.log(); // New line after install
  }
}

// =============================================================================
// Command Handlers
// =============================================================================

async function handleCommand(fiber: FiberPay, command: string, args: string[]): Promise<void> {
  switch (command) {
    case 'init':
    case 'initialize': {
      const result = await fiber.initialize({
        onDownloadProgress: showProgress,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'balance':
    case 'get-balance': {
      const result = await fiber.getBalance();
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'pay': {
      const params: { invoice?: string; recipientNodeId?: string; amountCkb?: number } = {};
      
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--invoice' && args[i + 1]) {
          params.invoice = args[++i];
        } else if (args[i] === '--to' && args[i + 1]) {
          params.recipientNodeId = args[++i];
        } else if (args[i] === '--amount' && args[i + 1]) {
          params.amountCkb = parseFloat(args[++i]);
        } else if (!args[i].startsWith('--')) {
          // Positional argument is assumed to be invoice
          params.invoice = args[i];
        }
      }

      const result = await fiber.pay(params);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'invoice':
    case 'create-invoice': {
      let amountCkb = 0;
      let description: string | undefined;
      let expiryMinutes: number | undefined;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--amount' && args[i + 1]) {
          amountCkb = parseFloat(args[++i]);
        } else if (args[i] === '--description' && args[i + 1]) {
          description = args[++i];
        } else if (args[i] === '--expiry' && args[i + 1]) {
          expiryMinutes = parseInt(args[++i]);
        } else if (!args[i].startsWith('--') && !amountCkb) {
          amountCkb = parseFloat(args[i]);
        }
      }

      if (!amountCkb) {
        console.error('Error: Amount required. Usage: invoice --amount <CKB>');
        process.exit(1);
      }

      const result = await fiber.createInvoice({ amountCkb, description, expiryMinutes });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'channels':
    case 'list-channels': {
      const result = await fiber.listChannels();
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'open-channel': {
      let peer = '';
      let fundingCkb = 0;
      let isPublic = true;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--peer' && args[i + 1]) {
          peer = args[++i];
        } else if (args[i] === '--funding' && args[i + 1]) {
          fundingCkb = parseFloat(args[++i]);
        } else if (args[i] === '--private') {
          isPublic = false;
        }
      }

      if (!peer || !fundingCkb) {
        console.error('Error: Usage: open-channel --peer <addr> --funding <CKB>');
        process.exit(1);
      }

      const result = await fiber.openChannel({ peer, fundingCkb, isPublic });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'close-channel': {
      let channelId = '';
      let force = false;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--channel' && args[i + 1]) {
          channelId = args[++i];
        } else if (args[i] === '--force') {
          force = true;
        } else if (!args[i].startsWith('--')) {
          channelId = args[i];
        }
      }

      if (!channelId) {
        console.error('Error: Channel ID required');
        process.exit(1);
      }

      const result = await fiber.closeChannel({ channelId, force });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'info':
    case 'node-info': {
      const result = await fiber.getNodeInfo();
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'allowance':
    case 'spending-allowance': {
      const allowance = fiber.getSpendingAllowance();
      console.log(JSON.stringify(allowance, null, 2));
      break;
    }

    case 'audit':
    case 'audit-log': {
      let limit = 20;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--limit' && args[i + 1]) {
          limit = parseInt(args[++i]);
        }
      }
      const log = fiber.getAuditLog({ limit });
      console.log(JSON.stringify(log, null, 2));
      break;
    }

    case 'tools':
    case 'mcp-tools': {
      // Output MCP tool definitions for agent integration
      console.log(JSON.stringify(Object.values(MCP_TOOLS), null, 2));
      break;
    }

    case 'help':
    default:
      printHelp();
      break;
  }
}

// =============================================================================
// Help
// =============================================================================

function printHelp(): void {
  console.log(`
fiber-pay - AI Agent Payment SDK for CKB Lightning Network

USAGE:
  fiber-pay <command> [options]

NODE MANAGEMENT:
  start                   Start the Fiber node (runs in foreground)
  stop                    Stop the running Fiber node
  status                  Check if node is running

COMMANDS (require running node - connect via RPC):
  info                    Get node information
  balance                 Get current balance information
  channels                List all payment channels
  peers                   List connected peers
  invoice                 Create an invoice to receive payment
  pay                     Pay an invoice or send directly
  open-channel            Open a new channel
  close-channel           Close a channel

BINARY MANAGEMENT:
  download                Download the Fiber binary for your platform
  binary-info             Check if binary is installed

OTHER:
  init                    One-off init test (starts node, gets info, stops)
  tools                   Output MCP tool definitions
  help                    Show this help

WORKFLOW:
  # 1. Download the Fiber binary (if not already installed)
  fiber-pay download

  # 2. Start the node (runs in foreground, keep this terminal open)
  fiber-pay start

  # 3. In another terminal, run commands:
  fiber-pay status
  fiber-pay info
  fiber-pay balance
  fiber-pay channels
  fiber-pay invoice --amount 10 --description "Test"
  fiber-pay pay <invoice>
  fiber-pay open-channel --peer <multiaddr> --funding <CKB>

  # 4. Stop the node (Ctrl+C in the start terminal, or:)
  fiber-pay stop

PAYMENT:
  fiber-pay pay <invoice>
  fiber-pay pay --invoice <invoice>
  fiber-pay pay --to <pubkey> --amount <CKB>   # keysend

INVOICE:
  fiber-pay invoice <amount>
  fiber-pay invoice --amount <CKB> --description "For coffee"

CHANNELS:
  fiber-pay open-channel --peer <multiaddr> --funding <CKB>
  fiber-pay open-channel --peer <peer_id> --funding <CKB>
  fiber-pay close-channel <channelId>
  fiber-pay close-channel <channelId> --force

ENVIRONMENT:
  FIBER_BINARY_PATH       Path to fnn binary (optional - auto-downloads if not set)
  FIBER_DATA_DIR          Data directory (default: ~/.fiber-pay)
  FIBER_NETWORK           Network: testnet or mainnet (default: testnet)
  FIBER_RPC_URL           RPC URL (default: http://127.0.0.1:8227)
  FIBER_KEY_PASSWORD      Password for key encryption
`);
}

// =============================================================================
// Standalone Commands (don't need FiberPay instance)
// =============================================================================

async function handleStandaloneCommand(command: string, args: string[], config: CliConfig): Promise<boolean> {
  switch (command) {
    case 'download':
    case 'download-binary': {
      let version: string | undefined;
      let force = false;
      
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--version' && args[i + 1]) {
          version = args[++i];
        } else if (args[i] === '--force' || args[i] === '-f') {
          force = true;
        }
      }

      console.log('Downloading Fiber Network Node binary...');
      
      const info = await downloadFiberBinary({
        installDir: `${config.dataDir}/bin`,
        version,
        force,
        onProgress: showProgress,
      });

      console.log('\n✅ Binary installed successfully!');
      console.log(JSON.stringify(info, null, 2));
      return true;
    }

    case 'binary-info':
    case 'check-binary': {
      const info = await getFiberBinaryInfo(`${config.dataDir}/bin`);
      
      if (info.ready) {
        console.log('✅ Binary is ready');
      } else {
        console.log('❌ Binary not found or not executable');
      }
      console.log(JSON.stringify(info, null, 2));
      return true;
    }

    default:
      return false;
  }
}

// =============================================================================
// RPC-only Commands (connect to running node)
// =============================================================================

/**
 * Create a FiberPay instance for agent commands
 */
async function createFiberPayInstance(config: CliConfig): Promise<FiberPay> {
  const fiber = createFiberPay({
    dataDir: config.dataDir,
    network: config.network,
    autoDownload: false,
    keyPassword: config.keyPassword,
  });

  await fiber.initialize();
  return fiber;
}

async function handleRpcCommand(command: string, args: string[], config: CliConfig): Promise<boolean> {
  const rpc = new FiberRpcClient({ url: config.rpcUrl! });
  
  // Check if node is running
  try {
    await rpc.waitForReady({ timeout: 3000 });
  } catch {
    console.error('❌ Node is not running. Start it first with: fiber-pay start');
    process.exit(1);
  }

  switch (command) {
    case 'info':
    case 'node-info': {
      const nodeInfo = await rpc.nodeInfo();
      
      // Convert lock script to CKB address
      const fundingAddress = scriptToAddress(nodeInfo.default_funding_lock_script, config.network);
      
      console.log(JSON.stringify({
        success: true,
        data: {
          nodeId: nodeInfo.peer_id,
          publicKey: nodeInfo.public_key,
          addresses: nodeInfo.addresses,
          chainHash: nodeInfo.chain_hash,
          fundingAddress: fundingAddress,
          fundingLockScript: nodeInfo.default_funding_lock_script,
          version: nodeInfo.version,
          channelCount: nodeInfo.channel_count,
          pendingChannelCount: nodeInfo.pending_channel_count,
          peersCount: nodeInfo.peers_count,
        }
      }, null, 2));
      return true;
    }

    case 'channels':
    case 'list-channels': {
      const channels = await rpc.listChannels({});
      console.log(JSON.stringify({
        success: true,
        data: {
          channels: channels.channels,
          count: channels.channels.length,
        }
      }, null, 2));
      return true;
    }

    case 'balance':
    case 'get-balance': {
      const channels = await rpc.listChannels({});
      let totalLocal = BigInt(0);
      let totalRemote = BigInt(0);
      let activeChannelCount = 0;
      
      for (const ch of channels.channels) {
        // Check for CHANNEL_READY state (case-insensitive)
        const stateName = ch.state?.state_name?.toUpperCase() || '';
        if (stateName === 'CHANNEL_READY' || stateName === 'CHANNELREADY') {
          totalLocal += BigInt(ch.local_balance);
          totalRemote += BigInt(ch.remote_balance);
          activeChannelCount++;
        }
      }
      
      const localCkb = Number(totalLocal) / 1e8;
      const remoteCkb = Number(totalRemote) / 1e8;
      
      console.log(JSON.stringify({
        success: true,
        data: {
          totalCkb: localCkb,
          availableToSend: localCkb,
          availableToReceive: remoteCkb,
          channelCount: channels.channels.length,
          activeChannelCount,
        }
      }, null, 2));
      return true;
    }

    case 'peers':
    case 'list-peers': {
      const peers = await rpc.listPeers();
      console.log(JSON.stringify({
        success: true,
        data: peers
      }, null, 2));
      return true;
    }

    case 'invoice':
    case 'create-invoice': {
      let amountCkb = 0;
      let description: string | undefined;
      let expiryMinutes: number | undefined;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--amount' && args[i + 1]) {
          amountCkb = parseFloat(args[++i]);
        } else if (args[i] === '--description' && args[i + 1]) {
          description = args[++i];
        } else if (args[i] === '--expiry' && args[i + 1]) {
          expiryMinutes = parseInt(args[++i]);
        } else if (!args[i].startsWith('--') && !amountCkb) {
          amountCkb = parseFloat(args[i]);
        }
      }

      if (!amountCkb) {
        console.error('Error: Amount required. Usage: invoice --amount <CKB>');
        process.exit(1);
      }

      const amountHex = ckbToShannons(amountCkb);
      const expirySeconds = (expiryMinutes || 60) * 60;
      const preimage = randomBytes32();
      const currency = config.network === 'mainnet' ? 'Fibb' : 'Fibt';

      const result = await rpc.newInvoice({
        amount: amountHex,
        currency,
        description,
        expiry: toHex(expirySeconds),
        payment_preimage: preimage,
      });

      const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();

      console.log(JSON.stringify({
        success: true,
        data: {
          invoice: result.invoice_address,
          paymentHash: result.invoice.payment_hash,
          amountCkb,
          expiresAt,
          status: 'open',
        }
      }, null, 2));
      return true;
    }

    case 'pay': {
      let invoice: string | undefined;
      let recipientNodeId: string | undefined;
      let amountCkb: number | undefined;
      let maxFeeCkb: number | undefined;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--invoice' && args[i + 1]) {
          invoice = args[++i];
        } else if (args[i] === '--to' && args[i + 1]) {
          recipientNodeId = args[++i];
        } else if (args[i] === '--amount' && args[i + 1]) {
          amountCkb = parseFloat(args[++i]);
        } else if (args[i] === '--max-fee' && args[i + 1]) {
          maxFeeCkb = parseFloat(args[++i]);
        } else if (!args[i].startsWith('--')) {
          // Positional argument is assumed to be invoice
          invoice = args[i];
        }
      }

      if (!invoice && !recipientNodeId) {
        console.error('Error: Either invoice or --to <nodeId> required');
        process.exit(1);
      }

      if (recipientNodeId && !amountCkb) {
        console.error('Error: --amount required when using --to');
        process.exit(1);
      }

      const result = await rpc.sendPayment({
        invoice,
        target_pubkey: recipientNodeId as HexString | undefined,
        amount: amountCkb ? ckbToShannons(amountCkb) : undefined,
        keysend: recipientNodeId ? true : undefined,
        max_fee_amount: maxFeeCkb ? ckbToShannons(maxFeeCkb) : undefined,
      });

      console.log(JSON.stringify({
        success: result.status === 'Success',
        data: {
          paymentHash: result.payment_hash,
          status: result.status === 'Success' ? 'success' : result.status === 'Failed' ? 'failed' : 'pending',
          feeCkb: shannonsToCkb(result.fee),
          failureReason: result.failed_error,
        }
      }, null, 2));
      return true;
    }

    case 'open-channel': {
      let peer = '';
      let fundingCkb = 0;
      let isPublic = true;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--peer' && args[i + 1]) {
          peer = args[++i];
        } else if (args[i] === '--funding' && args[i + 1]) {
          fundingCkb = parseFloat(args[++i]);
        } else if (args[i] === '--private') {
          isPublic = false;
        }
      }

      if (!peer || !fundingCkb) {
        console.error('Error: Usage: open-channel --peer <peer_id_or_multiaddr> --funding <CKB>');
        process.exit(1);
      }

      // If peer contains '/', it's a multiaddr - connect first
      let peerId = peer;
      if (peer.includes('/')) {
        await rpc.connectPeer({ address: peer });
        // Extract peer ID from multiaddr
        const peerIdMatch = peer.match(/\/p2p\/([^/]+)/);
        if (peerIdMatch) {
          peerId = peerIdMatch[1];
        }
      }

      const result = await rpc.openChannel({
        peer_id: peerId,
        funding_amount: ckbToShannons(fundingCkb),
        public: isPublic,
      });

      console.log(JSON.stringify({
        success: true,
        data: {
          temporaryChannelId: result.temporary_channel_id,
          peer: peerId,
          fundingCkb,
        }
      }, null, 2));
      return true;
    }

    case 'close-channel': {
      let channelId = '';
      let force = false;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--channel' && args[i + 1]) {
          channelId = args[++i];
        } else if (args[i] === '--force') {
          force = true;
        } else if (!args[i].startsWith('--')) {
          channelId = args[i];
        }
      }

      if (!channelId) {
        console.error('Error: Channel ID required');
        process.exit(1);
      }

      await rpc.shutdownChannel({
        channel_id: channelId as HexString,
        force,
      });

      console.log(JSON.stringify({
        success: true,
        data: {
          channelId,
          force,
          message: force ? 'Channel force close initiated' : 'Channel close initiated',
        }
      }, null, 2));
      return true;
    }

    case 'verify-invoice':
    case 'validate-invoice': {
      const invoice = args.find(arg => !arg.startsWith('--'));
      
      if (!invoice) {
        console.error('Error: Invoice required. Usage: verify-invoice <invoice-string>');
        process.exit(1);
      }

      // Create FiberPay instance
      const fiber = await createFiberPayInstance(config);
      const result = await fiber.validateInvoice(invoice);
      
      console.log(JSON.stringify(result, null, 2));
      return true;
    }

    case 'liquidity':
    case 'liquidity-report':
    case 'analyze-liquidity': {
      // Create FiberPay instance
      const fiber = await createFiberPayInstance(config);
      const result = await fiber.analyzeLiquidity();
      
      console.log(JSON.stringify(result, null, 2));
      return true;
    }

    case 'payment-proof':
    case 'get-proof': {
      const paymentHash = args.find(arg => !arg.startsWith('--'));
      
      if (!paymentHash) {
        console.error('Error: Payment hash required. Usage: payment-proof <payment-hash>');
        process.exit(1);
      }

      // Create FiberPay instance
      const fiber = await createFiberPayInstance(config);
      const result = await fiber.getPaymentProof(paymentHash);
      
      console.log(JSON.stringify(result, null, 2));
      return true;
    }

    case 'can-send': {
      let amountCkb = 0;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--amount' && args[i + 1]) {
          amountCkb = parseFloat(args[++i]);
        } else if (!args[i].startsWith('--')) {
          amountCkb = parseFloat(args[i]);
        }
      }

      if (!amountCkb) {
        console.error('Error: Amount required. Usage: can-send <CKB>');
        process.exit(1);
      }

      // Create FiberPay instance
      const fiber = await createFiberPayInstance(config);
      const result = await fiber.canSend(amountCkb);
      
      console.log(JSON.stringify(result, null, 2));
      return true;
    }

    default:
      return false;
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const commandArgs = args.slice(1);

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'tools' || command === 'mcp-tools') {
    console.log(JSON.stringify(Object.values(MCP_TOOLS), null, 2));
    return;
  }

  const config = getConfig();

  // Handle standalone commands that don't need FiberPay instance
  const standaloneCommands = ['download', 'download-binary', 'binary-info', 'check-binary'];
  if (standaloneCommands.includes(command)) {
    try {
      await handleStandaloneCommand(command, commandArgs, config);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
    return;
  }

  // Handle start command - run node in foreground
  if (command === 'start') {
    const fiber = createFiberPay({
      binaryPath: config.binaryPath,
      dataDir: config.dataDir,
      configFilePath: config.network === 'testnet' ? join(process.cwd(), 'testnet-config.yml') : undefined,
      chain: config.network,
      keyPassword: config.keyPassword,
    });

    // Check if already running
    const existingPid = readPidFile(config.dataDir);
    if (existingPid && isProcessRunning(existingPid)) {
      console.log(`❌ Node is already running (PID: ${existingPid})`);
      console.log('   Use "fiber-pay stop" to stop it first.');
      process.exit(1);
    }

    console.log('🚀 Starting Fiber node...');
    
    const initResult = await fiber.initialize({
      onDownloadProgress: showProgress,
    });
    
    if (!initResult.success) {
      console.error('Failed to initialize:', initResult.error?.message);
      process.exit(1);
    }

    // Write PID file
    writePidFile(config.dataDir, process.pid);

    console.log('✅ Fiber node started successfully!');
    console.log(JSON.stringify(initResult, null, 2));
    console.log('\n📡 Node is running. Press Ctrl+C to stop.');
    console.log(`   RPC endpoint: ${config.rpcUrl}`);
    console.log(`   Data dir: ${config.dataDir}`);

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down...');
      removePidFile(config.dataDir);
      await fiber.shutdown();
      console.log('✅ Node stopped.');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep process alive
    await new Promise(() => {});
    return;
  }

  // Handle stop command
  if (command === 'stop') {
    const pid = readPidFile(config.dataDir);
    
    if (!pid) {
      console.log('❌ No PID file found. Node may not be running.');
      process.exit(1);
    }

    if (!isProcessRunning(pid)) {
      console.log(`❌ Process ${pid} is not running. Cleaning up PID file.`);
      removePidFile(config.dataDir);
      process.exit(1);
    }

    console.log(`🛑 Stopping node (PID: ${pid})...`);
    process.kill(pid, 'SIGTERM');
    
    // Wait for process to stop
    let attempts = 0;
    while (isProcessRunning(pid) && attempts < 30) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    if (isProcessRunning(pid)) {
      console.log('⚠️  Process did not stop gracefully, force killing...');
      process.kill(pid, 'SIGKILL');
    }

    removePidFile(config.dataDir);
    console.log('✅ Node stopped.');
    return;
  }

  // Handle status command
  if (command === 'status') {
    const pid = readPidFile(config.dataDir);
    
    if (pid && isProcessRunning(pid)) {
      console.log(`✅ Node is running (PID: ${pid})`);
      
      // Try to get node info
      try {
        const rpc = new FiberRpcClient({ url: config.rpcUrl! });
        await rpc.waitForReady({ timeout: 3000 });
        const nodeInfo = await rpc.nodeInfo();
        console.log(`   Node ID: ${nodeInfo.peer_id}`);
        console.log(`   RPC: ${config.rpcUrl}`);
      } catch {
        console.log('   ⚠️  RPC not responding');
      }
    } else {
      if (pid) {
        console.log(`❌ Node is not running (stale PID file: ${pid})`);
        removePidFile(config.dataDir);
      } else {
        console.log('❌ Node is not running');
      }
      console.log('   Start with: fiber-pay start');
    }
    return;
  }

  // RPC-only commands (connect to running node)
  const rpcOnlyCommands = [
    'info', 'node-info', 
    'channels', 'list-channels', 
    'balance', 'get-balance', 
    'peers', 'list-peers',
    'invoice', 'create-invoice',
    'pay',
    'open-channel',
    'close-channel',
    'verify-invoice', 'validate-invoice',
    'liquidity', 'liquidity-report', 'analyze-liquidity',
    'payment-proof', 'get-proof',
    'can-send',
  ];
  if (rpcOnlyCommands.includes(command)) {
    try {
      const handled = await handleRpcCommand(command, commandArgs, config);
      if (!handled) {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
    return;
  }

  // Commands that need full FiberPay initialization (legacy - for init command only)
  const fiber = createFiberPay({
    binaryPath: config.binaryPath,
    dataDir: config.dataDir,
    configFilePath: config.network === 'testnet' ? join(process.cwd(), 'testnet-config.yml') : undefined,
    chain: config.network,
    keyPassword: config.keyPassword,
  });

  // These commands need initialization (init only - for one-off testing)
  const needsInit = ['init', 'initialize'];

  if (needsInit.includes(command)) {
    const initResult = await fiber.initialize({
      onDownloadProgress: showProgress,
    });
    if (!initResult.success) {
      console.error('Failed to initialize:', initResult.error?.message);
      process.exit(1);
    }
  }

  try {
    await handleCommand(fiber, command, commandArgs);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    if (needsInit.includes(command)) {
      await fiber.shutdown();
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

