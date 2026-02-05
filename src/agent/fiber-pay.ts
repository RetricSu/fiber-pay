/**
 * FiberPay - AI Agent-Friendly Payment Interface
 * High-level, LLM-friendly commands for payment operations
 * 
 * This is the primary interface designed for AI agents to manage
 * payments on the CKB Lightning Network (Fiber Network).
 */

import { FiberRpcClient, ckbToShannons, shannonsToCkb, randomBytes32, toHex, fromHex } from '../rpc/index.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { KeyManager, createKeyManager } from '../security/key-manager.js';
import { ProcessManager, FiberNodeConfig } from '../process/index.js';
import { ensureFiberBinary, getDefaultBinaryPath, type DownloadProgress } from '../binary/index.js';
import { InvoiceVerifier, type InvoiceVerificationResult } from '../verification/invoice-verifier.js';
import { PaymentProofManager, type PaymentProof, type PaymentProofSummary } from '../verification/payment-proof.js';
import { LiquidityAnalyzer, type LiquidityReport } from '../funds/liquidity-analyzer.js';
import type {
  SecurityPolicy,
  DEFAULT_SECURITY_POLICY,
  PolicyCheckResult,
  HexString,
  ChannelInfo,
  PaymentInfo,
  InvoiceInfo,
  NodeInfo,
} from '../types/index.js';

// =============================================================================
// Agent-Friendly Result Types
// =============================================================================

/**
 * Standard result format for all operations
 * Designed to be easily parsed by AI agents
 */
export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
    suggestion?: string;
  };
  metadata?: {
    timestamp: number;
    policyCheck?: PolicyCheckResult;
  };
}

/**
 * Balance information in human-readable format
 */
export interface BalanceInfo {
  /** Total balance across all channels (in CKB) */
  totalCkb: number;
  /** Available to send (in CKB) */
  availableToSend: number;
  /** Available to receive (in CKB) */
  availableToReceive: number;
  /** Number of active channels */
  channelCount: number;
  /** Remaining spending allowance this period (in CKB) */
  spendingAllowance: number;
}

/**
 * Payment result with tracking info
 */
export interface PaymentResult {
  /** Payment hash for tracking */
  paymentHash: string;
  /** Status of the payment */
  status: 'pending' | 'success' | 'failed';
  /** Amount sent (in CKB) */
  amountCkb: number;
  /** Fee paid (in CKB) */
  feeCkb: number;
  /** Error message if failed */
  failureReason?: string;
}

/**
 * Invoice result
 */
export interface InvoiceResult {
  /** Invoice string to share with payer */
  invoice: string;
  /** Payment hash for tracking */
  paymentHash: string;
  /** Amount to receive (in CKB) */
  amountCkb: number;
  /** Expiry time (ISO string) */
  expiresAt: string;
  /** Status */
  status: 'open' | 'paid' | 'expired' | 'cancelled';
}

/**
 * Channel summary
 */
export interface ChannelSummary {
  /** Channel ID */
  id: string;
  /** Peer node ID */
  peerId: string;
  /** Local balance (in CKB) */
  localBalanceCkb: number;
  /** Remote balance (in CKB) */
  remoteBalanceCkb: number;
  /** Channel state */
  state: string;
  /** Is public channel */
  isPublic: boolean;
}

/**
 * Verification result for invoices
 */
export type InvoiceValidationResult = InvoiceVerificationResult;

/**
 * Liquidity analysis result
 */
export type LiquidityAnalysisResult = LiquidityReport;

// =============================================================================
// FiberPay Agent Interface
// =============================================================================

export interface FiberPayConfig {
  /** Path to the fnn binary (optional - will auto-download if not provided) */
  binaryPath?: string;
  /** Base directory for all data */
  dataDir: string;
  /** Path to the config file (optional - will use built-in testnet config if not provided) */
  configFilePath?: string;
  /** Security policy */
  policy?: SecurityPolicy;
  /** Key encryption password (recommended: set via FIBER_KEY_PASSWORD env var) */
  keyPassword?: string;
  /** CKB RPC URL */
  ckbRpcUrl?: string;
  /** Chain: mainnet or testnet */
  chain?: 'mainnet' | 'testnet';
  /** Bootstrap nodes */
  bootnodes?: string[];
  /** Auto-start the node */
  autoStart?: boolean;
  /** RPC port */
  rpcPort?: number;
  /** P2P port */
  p2pPort?: number;
  /** Auto-download binary if not found */
  autoDownload?: boolean;
}

/**
 * FiberPay - Main interface for AI agents
 * 
 * @example
 * ```typescript
 * const fiber = new FiberPay({
 *   binaryPath: '/usr/local/bin/fnn',
 *   dataDir: '~/.fiber-pay',
 * });
 * 
 * await fiber.initialize();
 * 
 * // Check balance
 * const balance = await fiber.getBalance();
 * 
 * // Send payment
 * const result = await fiber.pay({
 *   invoice: 'fibt1...',
 * });
 * 
 * // Create invoice to receive payment
 * const invoice = await fiber.createInvoice({
 *   amountCkb: 10,
 *   description: 'Payment for services',
 * });
 * ```
 */
export class FiberPay {
  private config: FiberPayConfig;
  private process: ProcessManager | null = null;
  private rpc: FiberRpcClient | null = null;
  private policy: PolicyEngine;
  private keys: KeyManager;
  private initialized = false;
  private invoiceVerifier: InvoiceVerifier | null = null;
  private paymentProofManager: PaymentProofManager | null = null;
  private liquidityAnalyzer: LiquidityAnalyzer | null = null;

  constructor(config: FiberPayConfig) {
    this.config = {
      chain: 'testnet',
      autoStart: true,
      rpcPort: 8227,
      p2pPort: 8228,
      ...config,
    };

    // Initialize policy engine with default or custom policy
    const defaultPolicy: SecurityPolicy = {
      name: 'default',
      version: '1.0.0',
      enabled: true,
      spending: {
        maxPerTransaction: '0x2540be400', // 100 CKB
        maxPerWindow: '0x174876e800', // 1000 CKB
        windowSeconds: 3600,
      },
      rateLimit: {
        maxTransactions: 100,
        windowSeconds: 3600,
        cooldownSeconds: 1,
      },
      recipients: {
        allowUnknown: true,
      },
      channels: {
        allowOpen: true,
        allowClose: true,
        allowForceClose: false,
        maxChannels: 10,
      },
      auditLogging: true,
    };

    this.policy = new PolicyEngine(config.policy || defaultPolicy);

    // Initialize key manager
    this.keys = createKeyManager(config.dataDir, {
      encryptionPassword: config.keyPassword,
      autoGenerate: true,
    });
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Initialize the FiberPay instance
   * - Downloads the binary if needed (and autoDownload is true)
   * - Generates or loads keys
   * - Starts the Fiber node (if autoStart is true)
   * - Connects to RPC
   */
  async initialize(options?: {
    onDownloadProgress?: (progress: DownloadProgress) => void;
  }): Promise<AgentResult<{ nodeId: string; publicKey: string }>> {
    try {
      // Resolve binary path - download if needed
      let binaryPath = this.config.binaryPath;
      
      if (!binaryPath) {
        if (this.config.autoDownload !== false) {
          // Auto-download the binary
          binaryPath = await ensureFiberBinary({
            installDir: `${this.config.dataDir}/bin`,
            onProgress: options?.onDownloadProgress,
          });
        } else {
          return this.errorResult(
            new Error('Binary path not provided and autoDownload is disabled'),
            'BINARY_NOT_FOUND',
            true
          );
        }
      }

      // Initialize keys
      const keyInfo = await this.keys.initialize();

      // Create process manager
      this.process = new ProcessManager({
        binaryPath,
        dataDir: this.config.dataDir,
        configFilePath: this.config.configFilePath,
        chain: this.config.chain,
        ckbRpcUrl: this.config.ckbRpcUrl,
        keyPassword: this.config.keyPassword,
        rpcListeningAddr: `127.0.0.1:${this.config.rpcPort}`,
        fiberListeningAddr: `/ip4/0.0.0.0/tcp/${this.config.p2pPort}`,
        bootnodeAddrs: this.config.bootnodes,
      });

      // Create RPC client
      this.rpc = new FiberRpcClient({
        url: `http://127.0.0.1:${this.config.rpcPort}`,
      });

      // Start node if autoStart
      if (this.config.autoStart) {
        await this.process.start();
        await this.rpc.waitForReady({ timeout: 60000 });
      }

      // Initialize verification and analysis systems
      this.invoiceVerifier = new InvoiceVerifier(this.rpc);
      this.paymentProofManager = new PaymentProofManager(this.config.dataDir);
      await this.paymentProofManager.load();
      this.liquidityAnalyzer = new LiquidityAnalyzer(this.rpc);

      this.initialized = true;

      // Get node info
      const nodeInfo = await this.rpc.nodeInfo();

      this.policy.addAuditEntry('NODE_STARTED', true, {
        nodeId: nodeInfo.peer_id,
        publicKey: nodeInfo.public_key,
      });

      return {
        success: true,
        data: {
          nodeId: nodeInfo.peer_id,
          publicKey: nodeInfo.public_key,
        },
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'INIT_FAILED', false);
    }
  }

  /**
   * Shutdown the FiberPay instance
   */
  async shutdown(): Promise<AgentResult<void>> {
    try {
      // Save payment proofs before shutdown
      if (this.paymentProofManager) {
        await this.paymentProofManager.save();
      }

      if (this.process?.isRunning()) {
        await this.process.stop();
      }
      this.policy.addAuditEntry('NODE_STOPPED', true, {});
      this.initialized = false;
      return { success: true, metadata: { timestamp: Date.now() } };
    } catch (error) {
      return this.errorResult(error, 'SHUTDOWN_FAILED', true);
    }
  }

  // ===========================================================================
  // Payment Methods (AI Agent Friendly)
  // ===========================================================================

  /**
   * Pay an invoice or send directly to a node
   * 
   * @example
   * // Pay invoice
   * await fiber.pay({ invoice: 'fibt1...' });
   * 
   * // Send directly (keysend)
   * await fiber.pay({ 
   *   recipientNodeId: 'QmXXX...',
   *   amountCkb: 10,
   * });
   */
  async pay(params: {
    /** Invoice string to pay */
    invoice?: string;
    /** Recipient node ID for keysend */
    recipientNodeId?: string;
    /** Amount in CKB (for keysend) */
    amountCkb?: number;
    /** Maximum fee in CKB */
    maxFeeCkb?: number;
  }): Promise<AgentResult<PaymentResult>> {
    this.ensureInitialized();

    try {
      // Determine amount
      let amountHex: HexString;
      let recipient: string | undefined;

      if (params.invoice) {
        // Parse invoice to get amount
        const parsed = await this.rpc!.parseInvoice({ invoice: params.invoice });
        amountHex = parsed.invoice.amount || '0x0';
        recipient = params.invoice; // Use invoice as recipient identifier for policy
      } else if (params.recipientNodeId && params.amountCkb) {
        amountHex = ckbToShannons(params.amountCkb);
        recipient = params.recipientNodeId;
      } else {
        return this.errorResult(
          new Error('Either invoice or (recipientNodeId + amountCkb) required'),
          'INVALID_PARAMS',
          true
        );
      }

      // Check policy
      const policyCheck = this.policy.checkPayment({
        amount: amountHex,
        recipient,
      });

      if (!policyCheck.allowed) {
        this.policy.addAuditEntry('POLICY_VIOLATION', false, params, policyCheck.violations);
        return {
          success: false,
          error: {
            code: 'POLICY_VIOLATION',
            message: policyCheck.violations.map((v) => v.message).join('; '),
            recoverable: false,
            suggestion: 'Reduce amount or wait for spending window to reset',
          },
          metadata: { timestamp: Date.now(), policyCheck },
        };
      }

      // Execute payment
      const result = await this.rpc!.sendPayment({
        invoice: params.invoice,
        target_pubkey: params.recipientNodeId as HexString | undefined,
        amount: params.recipientNodeId ? amountHex : undefined,
        keysend: params.recipientNodeId ? true : undefined,
        max_fee_amount: params.maxFeeCkb ? ckbToShannons(params.maxFeeCkb) : undefined,
      });

      // Record successful payment
      if (result.status === 'Success') {
        this.policy.recordPayment(amountHex);
      }

      const paymentResult: PaymentResult = {
        paymentHash: result.payment_hash,
        status: result.status === 'Success' ? 'success' : result.status === 'Failed' ? 'failed' : 'pending',
        amountCkb: shannonsToCkb(amountHex),
        feeCkb: shannonsToCkb(result.fee),
        failureReason: result.failed_error,
      };

      // Record payment proof
      if (this.paymentProofManager && result.status === 'Success') {
        this.paymentProofManager.recordPaymentProof(
          result.payment_hash,
          params.invoice || '',
          {
            paymentHash: result.payment_hash,
            amountCkb: paymentResult.amountCkb,
            description: '',
          },
          {
            amountCkb: paymentResult.amountCkb,
            feeCkb: paymentResult.feeCkb,
            actualTimestamp: Date.now(),
            requestTimestamp: Date.now(),
          },
          result.status,
          {
            preimage: undefined, // Would need to get from RPC if available
          }
        );
        // Save asynchronously (don't wait)
        this.paymentProofManager.save().catch(() => {
          // Ignore save errors
        });
      }

      this.policy.addAuditEntry('PAYMENT_SENT', result.status === 'Success', {
        ...paymentResult,
        recipient,
      });

      return {
        success: result.status === 'Success',
        data: paymentResult,
        metadata: { timestamp: Date.now(), policyCheck },
      };
    } catch (error) {
      return this.errorResult(error, 'PAYMENT_FAILED', true);
    }
  }

  /**
   * Create an invoice to receive payment
   * 
   * @example
   * const invoice = await fiber.createInvoice({
   *   amountCkb: 10,
   *   description: 'For coffee',
   *   expiryMinutes: 60,
   * });
   * console.log(invoice.data?.invoice); // Share this with payer
   */
  async createInvoice(params: {
    /** Amount to receive in CKB */
    amountCkb: number;
    /** Description for the payer */
    description?: string;
    /** Expiry time in minutes (default: 60) */
    expiryMinutes?: number;
  }): Promise<AgentResult<InvoiceResult>> {
    this.ensureInitialized();

    try {
      const amountHex = ckbToShannons(params.amountCkb);
      const expirySeconds = (params.expiryMinutes || 60) * 60;
      const preimage = randomBytes32();

      const result = await this.rpc!.newInvoice({
        amount: amountHex,
        currency: this.config.chain === 'mainnet' ? 'Fibb' : 'Fibt',
        description: params.description,
        expiry: toHex(expirySeconds),
        payment_preimage: preimage,
      });

      const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();

      const invoiceResult: InvoiceResult = {
        invoice: result.invoice_address,
        paymentHash: result.invoice.payment_hash,
        amountCkb: params.amountCkb,
        expiresAt,
        status: 'open',
      };

      this.policy.addAuditEntry('INVOICE_CREATED', true, { ...invoiceResult });

      return {
        success: true,
        data: invoiceResult,
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'INVOICE_FAILED', true);
    }
  }

  /**
   * Get current balance information
   */
  async getBalance(): Promise<AgentResult<BalanceInfo>> {
    this.ensureInitialized();

    try {
      const channels = await this.rpc!.listChannels({});
      
      let totalLocal = 0n;
      let totalRemote = 0n;
      let activeChannels = 0;

      for (const channel of channels.channels) {
        if (channel.state.state_name === 'ChannelReady') {
          totalLocal += fromHex(channel.local_balance);
          totalRemote += fromHex(channel.remote_balance);
          activeChannels++;
        }
      }

      const allowance = this.policy.getRemainingAllowance();

      return {
        success: true,
        data: {
          totalCkb: Number(totalLocal) / 1e8,
          availableToSend: Number(totalLocal) / 1e8,
          availableToReceive: Number(totalRemote) / 1e8,
          channelCount: activeChannels,
          spendingAllowance: Number(allowance.perWindow) / 1e8,
        },
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'BALANCE_FAILED', true);
    }
  }

  /**
   * Check payment status
   */
  async getPaymentStatus(paymentHash: string): Promise<AgentResult<PaymentResult>> {
    this.ensureInitialized();

    try {
      const result = await this.rpc!.getPayment({ payment_hash: paymentHash as HexString });

      return {
        success: true,
        data: {
          paymentHash: result.payment_hash,
          status: result.status === 'Success' ? 'success' : result.status === 'Failed' ? 'failed' : 'pending',
          amountCkb: 0, // Amount not returned from get_payment
          feeCkb: shannonsToCkb(result.fee),
          failureReason: result.failed_error,
        },
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'STATUS_CHECK_FAILED', true);
    }
  }

  /**
   * Check invoice status
   */
  async getInvoiceStatus(paymentHash: string): Promise<AgentResult<InvoiceResult>> {
    this.ensureInitialized();

    try {
      const result = await this.rpc!.getInvoice({ payment_hash: paymentHash as HexString });

      return {
        success: true,
        data: {
          invoice: result.invoice_address,
          paymentHash: result.payment_hash,
          amountCkb: result.amount ? shannonsToCkb(result.amount) : 0,
          expiresAt: result.expiry ? new Date(Number(fromHex(result.created_at)) + Number(fromHex(result.expiry)) * 1000).toISOString() : '',
          status: result.status.toLowerCase() as 'open' | 'paid' | 'expired' | 'cancelled',
        },
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'INVOICE_STATUS_FAILED', true);
    }
  }

  // ===========================================================================
  // Channel Management
  // ===========================================================================

  /**
   * List all channels
   */
  async listChannels(): Promise<AgentResult<ChannelSummary[]>> {
    this.ensureInitialized();

    try {
      const result = await this.rpc!.listChannels({});

      const channels: ChannelSummary[] = result.channels.map((ch) => ({
        id: ch.channel_id,
        peerId: ch.peer_id,
        localBalanceCkb: shannonsToCkb(ch.local_balance),
        remoteBalanceCkb: shannonsToCkb(ch.remote_balance),
        state: ch.state.state_name,
        isPublic: ch.is_public,
      }));

      return {
        success: true,
        data: channels,
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'LIST_CHANNELS_FAILED', true);
    }
  }

  /**
   * Open a new channel
   */
  async openChannel(params: {
    /** Peer node ID or address */
    peer: string;
    /** Funding amount in CKB */
    fundingCkb: number;
    /** Make channel public */
    isPublic?: boolean;
  }): Promise<AgentResult<{ channelId: string }>> {
    this.ensureInitialized();

    try {
      const fundingHex = ckbToShannons(params.fundingCkb);
      const channels = await this.rpc!.listChannels({});

      // Check policy
      const policyCheck = this.policy.checkChannelOperation({
        operation: 'open',
        fundingAmount: fundingHex,
        currentChannelCount: channels.channels.length,
      });

      if (!policyCheck.allowed) {
        this.policy.addAuditEntry('POLICY_VIOLATION', false, params, policyCheck.violations);
        return {
          success: false,
          error: {
            code: 'POLICY_VIOLATION',
            message: policyCheck.violations.map((v) => v.message).join('; '),
            recoverable: false,
          },
          metadata: { timestamp: Date.now(), policyCheck },
        };
      }

      // Connect to peer if address provided
      if (params.peer.includes('/')) {
        await this.rpc!.connectPeer({ address: params.peer });
        // Extract peer ID from multiaddr
        const peerIdMatch = params.peer.match(/\/p2p\/([^/]+)/);
        if (peerIdMatch) {
          params.peer = peerIdMatch[1];
        }
      }

      const result = await this.rpc!.openChannel({
        peer_id: params.peer,
        funding_amount: fundingHex,
        public: params.isPublic ?? true,
      });

      this.policy.addAuditEntry('CHANNEL_OPENED', true, {
        channelId: result.temporary_channel_id,
        peer: params.peer,
        fundingCkb: params.fundingCkb,
      });

      return {
        success: true,
        data: { channelId: result.temporary_channel_id },
        metadata: { timestamp: Date.now(), policyCheck },
      };
    } catch (error) {
      return this.errorResult(error, 'OPEN_CHANNEL_FAILED', true);
    }
  }

  /**
   * Close a channel
   */
  async closeChannel(params: {
    /** Channel ID */
    channelId: string;
    /** Force close (unilateral) */
    force?: boolean;
  }): Promise<AgentResult<void>> {
    this.ensureInitialized();

    try {
      const operation = params.force ? 'force_close' : 'close';
      const policyCheck = this.policy.checkChannelOperation({ operation });

      if (!policyCheck.allowed) {
        this.policy.addAuditEntry('POLICY_VIOLATION', false, params, policyCheck.violations);
        return {
          success: false,
          error: {
            code: 'POLICY_VIOLATION',
            message: policyCheck.violations.map((v) => v.message).join('; '),
            recoverable: false,
          },
          metadata: { timestamp: Date.now(), policyCheck },
        };
      }

      await this.rpc!.shutdownChannel({
        channel_id: params.channelId as HexString,
        force: params.force,
      });

      this.policy.addAuditEntry('CHANNEL_CLOSED', true, params);

      return {
        success: true,
        metadata: { timestamp: Date.now(), policyCheck },
      };
    } catch (error) {
      return this.errorResult(error, 'CLOSE_CHANNEL_FAILED', true);
    }
  }

  // ===========================================================================
  // Node Information
  // ===========================================================================

  /**
   * Get node information
   */
  async getNodeInfo(): Promise<AgentResult<{
    nodeId: string;
    publicKey: string;
    version: string;
    channelCount: number;
    peersCount: number;
  }>> {
    this.ensureInitialized();

    try {
      const info = await this.rpc!.nodeInfo();

      return {
        success: true,
        data: {
          nodeId: info.peer_id,
          publicKey: info.public_key,
          version: info.version,
          channelCount: info.channel_count,
          peersCount: info.peers_count,
        },
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'NODE_INFO_FAILED', true);
    }
  }

  // ===========================================================================
  // Verification & Validation Methods
  // ===========================================================================

  /**
   * Validate an invoice before payment
   * Checks format, expiry, amount, cryptographic correctness, and peer connectivity
   * 
   * @example
   * ```typescript
   * const validation = await fiber.validateInvoice('fibt1...');
   * if (validation.data?.recommendation === 'reject') {
   *   console.log('Do not pay:', validation.data.reason);
   * }
   * ```
   */
  async validateInvoice(invoice: string): Promise<AgentResult<InvoiceValidationResult>> {
    this.ensureInitialized();

    try {
      if (!this.invoiceVerifier) {
        throw new Error('Invoice verifier not initialized');
      }

      const result = await this.invoiceVerifier.verifyInvoice(invoice);

      this.policy.addAuditEntry('INVOICE_VALIDATED', true, {
        paymentHash: result.details.paymentHash,
        amountCkb: result.details.amountCkb,
        valid: result.valid,
      });

      return {
        success: true,
        data: result,
        metadata: {
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      return this.errorResult(error, 'INVOICE_VALIDATION_FAILED', true);
    }
  }

  /**
   * Get payment proof (cryptographic evidence of payment)
   * Returns stored proof if available, or creates one from RPC status
   */
  async getPaymentProof(paymentHash: string): Promise<AgentResult<{
    proof: PaymentProof | null;
    verified: boolean;
    status: string;
  }>> {
    this.ensureInitialized();

    try {
      if (!this.paymentProofManager) {
        throw new Error('Payment proof manager not initialized');
      }

      const storedProof = this.paymentProofManager.getProof(paymentHash);

      if (storedProof) {
        const verification = this.paymentProofManager.verifyProof(storedProof);
        await this.paymentProofManager.save();

        return {
          success: true,
          data: {
            proof: storedProof,
            verified: verification.valid,
            status: verification.reason,
          },
          metadata: { timestamp: Date.now() },
        };
      }

      // Try to fetch from RPC
      const paymentStatus = await this.rpc!.getPayment({ payment_hash: paymentHash as HexString });

      return {
        success: true,
        data: {
          proof: null,
          verified: paymentStatus.status === 'Success',
          status: `Payment status: ${paymentStatus.status}`,
        },
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'PROOF_FETCH_FAILED', true);
    }
  }

  /**
   * Get payment proof summary for audit trail
   */
  async getPaymentProofSummary(): Promise<AgentResult<PaymentProofSummary>> {
    this.ensureInitialized();

    try {
      if (!this.paymentProofManager) {
        throw new Error('Payment proof manager not initialized');
      }

      const summary = this.paymentProofManager.getSummary();

      return {
        success: true,
        data: summary,
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'PROOF_SUMMARY_FAILED', true);
    }
  }

  /**
   * Export payment audit report
   */
  async getPaymentAuditReport(options?: {
    startTime?: number;
    endTime?: number;
  }): Promise<AgentResult<string>> {
    this.ensureInitialized();

    try {
      if (!this.paymentProofManager) {
        throw new Error('Payment proof manager not initialized');
      }

      const report = this.paymentProofManager.exportAuditReport(options?.startTime, options?.endTime);

      return {
        success: true,
        data: report,
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'AUDIT_REPORT_FAILED', true);
    }
  }

  // ===========================================================================
  // Liquidity & Fund Management Methods
  // ===========================================================================

  /**
   * Analyze liquidity across all channels
   * Provides detailed health metrics and recommendations
   * 
   * @example
   * ```typescript
   * const analysis = await fiber.analyzeLiquidity();
   * console.log(`Health score: ${analysis.data?.channels.averageHealthScore}`);
   * console.log(analysis.data?.summary);
   * ```
   */
  async analyzeLiquidity(): Promise<AgentResult<LiquidityAnalysisResult>> {
    this.ensureInitialized();

    try {
      if (!this.liquidityAnalyzer) {
        throw new Error('Liquidity analyzer not initialized');
      }

      const report = await this.liquidityAnalyzer.analyzeLiquidity();

      return {
        success: true,
        data: report,
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'LIQUIDITY_ANALYSIS_FAILED', true);
    }
  }

  /**
   * Check if you have enough liquidity to send a specific amount
   */
  async canSend(amountCkb: number): Promise<AgentResult<{
    canSend: boolean;
    shortfallCkb: number;
    availableCkb: number;
    recommendation: string;
  }>> {
    this.ensureInitialized();

    try {
      if (!this.liquidityAnalyzer) {
        throw new Error('Liquidity analyzer not initialized');
      }

      const result = await this.liquidityAnalyzer.getMissingLiquidityForAmount(amountCkb);

      const balance = await this.getBalance();
      const availableCkb = balance.data?.availableToSend || 0;

      return {
        success: true,
        data: {
          canSend: result.canSend,
          shortfallCkb: result.shortfallCkb,
          availableCkb,
          recommendation: result.recommendation,
        },
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'LIQUIDITY_CHECK_FAILED', true);
    }
  }

  // ===========================================================================
  // Policy Management
  // ===========================================================================

  /**
   * Get remaining spending allowance
   */
  getSpendingAllowance(): { perTransactionCkb: number; perWindowCkb: number } {
    const allowance = this.policy.getRemainingAllowance();
    return {
      perTransactionCkb: Number(allowance.perTransaction) / 1e8,
      perWindowCkb: Number(allowance.perWindow) / 1e8,
    };
  }

  /**
   * Get audit log
   */
  getAuditLog(options?: { limit?: number; since?: number }) {
    return this.policy.getAuditLog(options);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('FiberPay not initialized. Call initialize() first.');
    }
  }

  private errorResult<T>(
    error: unknown,
    code: string,
    recoverable: boolean
  ): AgentResult<T> {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: {
        code,
        message,
        recoverable,
      },
      metadata: { timestamp: Date.now() },
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a FiberPay instance with sensible defaults
 * Binary will be auto-downloaded if not provided
 */
export function createFiberPay(options?: {
  /** Path to the fnn binary (optional - will auto-download if not provided) */
  binaryPath?: string;
  /** Base directory for data */
  dataDir?: string;
  /** Path to the config file (optional - will use built-in testnet config if not provided) */
  configFilePath?: string;
  /** Network: testnet or mainnet */
  network?: 'testnet' | 'mainnet';
  /** Chain: testnet or mainnet (alias for network) */
  chain?: 'testnet' | 'mainnet';
  /** Auto-download binary if not found (default: true) */
  autoDownload?: boolean;
  /** Key encryption password */
  keyPassword?: string;
}): FiberPay {
  const dataDir = options?.dataDir || `${process.env.HOME}/.fiber-pay`;
  
  return new FiberPay({
    binaryPath: options?.binaryPath,
    dataDir,
    configFilePath: options?.configFilePath,
    chain: options?.chain || options?.network || 'testnet',
    autoDownload: options?.autoDownload ?? true,
    keyPassword: options?.keyPassword,
  });
}
