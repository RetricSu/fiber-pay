/**
 * FiberPay - AI Agent-Friendly Payment Interface
 * High-level, LLM-friendly commands for payment operations
 *
 * This is the primary interface designed for AI agents to manage
 * payments on the CKB Lightning Network (Fiber Network).
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DownloadProgress } from '@fiber-pay/node';
import {
  createKeyManager,
  ensureFiberBinary,
  type KeyManager,
  ProcessManager,
} from '@fiber-pay/node';
import {
  JobManager,
  type PaymentProof,
  PaymentProofManager,
  type PaymentProofSummary,
  type RuntimeJob,
  SqliteJobStore,
} from '@fiber-pay/runtime';
import type {
  Attribute,
  CkbInvoice,
  CkbInvoiceStatus,
  HexString,
  InvoiceVerificationResult,
  LiquidityReport,
  PolicyCheckResult,
  SecurityPolicy,
} from '@fiber-pay/sdk';
import {
  ChannelState,
  ckbToShannons,
  FiberRpcClient,
  fromHex,
  InvoiceVerifier,
  LiquidityAnalyzer,
  PolicyEngine,
  randomBytes32,
  shannonsToCkb,
  toHex,
} from '@fiber-pay/sdk';

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
  status: 'open' | 'accepted' | 'settled' | 'cancelled';
}

/**
 * Hold invoice result (for escrow / conditional payments)
 */
export interface HoldInvoiceResult {
  /** Invoice string to share with payer */
  invoice: string;
  /** Payment hash for tracking */
  paymentHash: string;
  /** Amount to receive (in CKB) */
  amountCkb: number;
  /** Expiry time (ISO string) */
  expiresAt: string;
  /** Status — starts as 'open', becomes 'accepted' when payer sends */
  status: 'open' | 'accepted' | 'settled' | 'cancelled';
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
  /** RPC URL for connecting to an existing node (when autoStart is false) */
  rpcUrl?: string;
  /** Enable runtime job orchestration for payments/invoices/channels (default: true) */
  useRuntimeJobs?: boolean;
  /** Optional sqlite path for runtime jobs */
  runtimeJobsDbPath?: string;
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
  private runtimeJobStore: SqliteJobStore | null = null;
  private runtimeJobManager: JobManager | null = null;

  constructor(config: FiberPayConfig) {
    this.config = {
      chain: 'testnet',
      autoStart: true,
      rpcPort: 8227,
      p2pPort: 8228,
      useRuntimeJobs: true,
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
  }): Promise<AgentResult<{ nodeId: string }>> {
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
            true,
          );
        }
      }

      // Initialize keys
      const _keyInfo = await this.keys.initialize();

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

      // Create RPC client - use provided rpcUrl or construct from rpcPort
      const rpcUrl = this.config.rpcUrl || `http://127.0.0.1:${this.config.rpcPort}`;
      this.rpc = new FiberRpcClient({
        url: rpcUrl,
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

      if (this.config.useRuntimeJobs !== false) {
        this.runtimeJobStore = new SqliteJobStore(
          this.config.runtimeJobsDbPath ?? join(this.config.dataDir, 'runtime-jobs.db'),
        );
        this.runtimeJobManager = new JobManager(this.rpc, this.runtimeJobStore);
        this.runtimeJobManager.start();
      }

      this.initialized = true;

      // Get node info
      const nodeInfo = await this.rpc.nodeInfo();

      this.policy.addAuditEntry('NODE_STARTED', true, {
        nodeId: nodeInfo.node_id,
      });

      return {
        success: true,
        data: {
          nodeId: nodeInfo.node_id,
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

      if (this.runtimeJobManager) {
        await this.runtimeJobManager.stop();
      }
      if (this.runtimeJobStore) {
        this.runtimeJobStore.close();
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
    /** Custom TLV records to attach (up to 2KB) */
    customRecords?: Record<string, HexString>;
    /** Maximum number of MPP parts (e.g. 4) */
    maxParts?: number;
  }): Promise<AgentResult<PaymentResult>> {
    this.ensureInitialized();

    try {
      // Determine amount
      let amountHex: HexString;
      let recipient: string | undefined;

      if (params.invoice) {
        // Parse invoice to get amount
        const parsed = await this.getRpc().parseInvoice({ invoice: params.invoice });
        amountHex = parsed.invoice.amount || '0x0';
        recipient = params.invoice; // Use invoice as recipient identifier for policy
      } else if (params.recipientNodeId && params.amountCkb) {
        amountHex = ckbToShannons(params.amountCkb);
        recipient = params.recipientNodeId;
      } else {
        return this.errorResult(
          new Error('Either invoice or (recipientNodeId + amountCkb) required'),
          'INVALID_PARAMS',
          true,
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

      const paymentParams = {
        invoice: params.invoice,
        target_pubkey: params.recipientNodeId as HexString | undefined,
        amount: params.recipientNodeId ? amountHex : undefined,
        keysend: params.recipientNodeId ? true : undefined,
        max_fee_amount: params.maxFeeCkb ? ckbToShannons(params.maxFeeCkb) : undefined,
        custom_records: params.customRecords,
        max_parts: params.maxParts ? toHex(params.maxParts) : undefined,
      };

      // Execute payment through runtime job manager when enabled
      let result: Awaited<ReturnType<FiberRpcClient['sendPayment']>>;
      if (this.runtimeJobManager) {
        const job = await this.runtimeJobManager.ensurePayment(
          {
            invoice: params.invoice,
            sendPaymentParams: paymentParams,
          },
          {
            idempotencyKey: params.invoice ? `payment:invoice:${params.invoice}` : undefined,
          },
        );
        const terminal = await this.waitForRuntimeJobTerminal(job.id, 120_000);
        if (terminal.type !== 'payment' || terminal.state !== 'succeeded' || !terminal.result) {
          throw new Error(terminal.error?.message ?? 'Runtime payment job failed');
        }
        result = {
          payment_hash: terminal.result.paymentHash as HexString,
          status: terminal.result.status as 'Success' | 'Failed' | 'Inflight' | 'Created',
          fee: terminal.result.fee as HexString,
          failed_error: terminal.result.failedError,
          created_at: '0x0',
          last_updated_at: '0x0',
          custom_records: undefined,
          routers: undefined,
        };
      } else {
        result = await this.getRpc().sendPayment(paymentParams);
      }

      // Record successful payment
      if (result.status === 'Success') {
        this.policy.recordPayment(amountHex);
      }

      const paymentResult: PaymentResult = {
        paymentHash: result.payment_hash,
        status:
          result.status === 'Success'
            ? 'success'
            : result.status === 'Failed'
              ? 'failed'
              : 'pending',
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
          },
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
      const invoiceParams: Parameters<FiberRpcClient['newInvoice']>[0] = {
        amount: amountHex,
        currency: this.config.chain === 'mainnet' ? 'Fibb' : 'Fibt',
        description: params.description,
        expiry: toHex(expirySeconds),
        payment_preimage: preimage,
      };

      let invoiceAddress: string;
      let paymentHash: string;

      if (this.runtimeJobManager) {
        const job = await this.runtimeJobManager.manageInvoice({
          action: 'create',
          newInvoiceParams: invoiceParams,
          waitForTerminal: false,
        });
        const terminal = await this.waitForRuntimeJobTerminal(job.id, 120_000);
        if (
          terminal.type !== 'invoice' ||
          terminal.state !== 'succeeded' ||
          !terminal.result?.invoiceAddress ||
          !terminal.result.paymentHash
        ) {
          throw new Error(terminal.error?.message ?? 'Runtime invoice job failed');
        }
        invoiceAddress = terminal.result.invoiceAddress;
        paymentHash = terminal.result.paymentHash;
      } else {
        const result = await this.getRpc().newInvoice(invoiceParams);
        invoiceAddress = result.invoice_address;
        paymentHash = result.invoice.data.payment_hash;
      }

      const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();

      const invoiceResult: InvoiceResult = {
        invoice: invoiceAddress,
        paymentHash,
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
      const channels = await this.getRpc().listChannels({});

      let totalLocal = 0n;
      let totalRemote = 0n;
      let activeChannels = 0;

      for (const channel of channels.channels) {
        if (channel.state.state_name === ChannelState.ChannelReady) {
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
      const result = await this.getRpc().getPayment({ payment_hash: paymentHash as HexString });

      return {
        success: true,
        data: {
          paymentHash: result.payment_hash,
          status:
            result.status === 'Success'
              ? 'success'
              : result.status === 'Failed'
                ? 'failed'
                : 'pending',
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
      const result = await this.getRpc().getInvoice({ payment_hash: paymentHash as HexString });

      const amountCkb = result.invoice.amount ? shannonsToCkb(result.invoice.amount) : 0;
      const expiresAt = this.getInvoiceExpiryIso(result.invoice);

      return {
        success: true,
        data: {
          invoice: result.invoice_address,
          paymentHash: result.invoice.data.payment_hash,
          amountCkb,
          expiresAt,
          status: this.mapInvoiceStatus(result.status),
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
      const result = await this.getRpc().listChannels({});

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
    /**
     * Optional idempotency key for retries.
     * Reuse the same key when retrying the same open intent; use a new key for a distinct open request.
     */
    idempotencyKey?: string;
  }): Promise<AgentResult<{ channelId: string }>> {
    this.ensureInitialized();

    try {
      const fundingHex = ckbToShannons(params.fundingCkb);
      const channels = await this.getRpc().listChannels({});

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
        await this.getRpc().connectPeer({ address: params.peer });
        // Extract peer ID from multiaddr
        const peerIdMatch = params.peer.match(/\/p2p\/([^/]+)/);
        if (peerIdMatch) {
          params.peer = peerIdMatch[1];
        }
      }

      const openParams = {
        peer_id: params.peer,
        funding_amount: fundingHex,
        public: params.isPublic ?? true,
      };
      const idempotencyKey = params.idempotencyKey ?? `open:${openParams.peer_id}:${randomUUID()}`;

      let temporaryChannelId: string;
      if (this.runtimeJobManager) {
        const job = await this.runtimeJobManager.manageChannel(
          {
            action: 'open',
            openChannelParams: openParams,
            waitForReady: false,
            peerId: params.peer,
          },
          { idempotencyKey },
        );
        const terminal = await this.waitForRuntimeJobTerminal(job.id, 120_000);
        if (
          terminal.type !== 'channel' ||
          terminal.state !== 'succeeded' ||
          !terminal.result?.temporaryChannelId
        ) {
          throw new Error(terminal.error?.message ?? 'Runtime channel open job failed');
        }
        temporaryChannelId = terminal.result.temporaryChannelId;
      } else {
        const result = await this.getRpc().openChannel(openParams);
        temporaryChannelId = result.temporary_channel_id;
      }

      this.policy.addAuditEntry('CHANNEL_OPENED', true, {
        channelId: temporaryChannelId,
        peer: params.peer,
        fundingCkb: params.fundingCkb,
      });

      return {
        success: true,
        data: { channelId: temporaryChannelId },
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

      if (this.runtimeJobManager) {
        const job = await this.runtimeJobManager.manageChannel(
          {
            action: 'shutdown',
            channelId: params.channelId as HexString,
            shutdownChannelParams: {
              channel_id: params.channelId as HexString,
              force: params.force,
            },
            waitForClosed: false,
          },
          { idempotencyKey: `channel:shutdown:${params.channelId}` },
        );
        const terminal = await this.waitForRuntimeJobTerminal(job.id, 120_000);
        if (terminal.type !== 'channel' || terminal.state !== 'succeeded') {
          throw new Error(terminal.error?.message ?? 'Runtime channel close job failed');
        }
      } else {
        await this.getRpc().shutdownChannel({
          channel_id: params.channelId as HexString,
          force: params.force,
        });
      }

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
  async getNodeInfo(): Promise<
    AgentResult<{
      nodeId: string;
      version: string;
      channelCount: number;
      peersCount: number;
    }>
  > {
    this.ensureInitialized();

    try {
      const info = await this.getRpc().nodeInfo();

      return {
        success: true,
        data: {
          nodeId: info.node_id,
          version: info.version,
          channelCount: parseInt(info.channel_count, 16),
          peersCount: parseInt(info.peers_count, 16),
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
  async getPaymentProof(paymentHash: string): Promise<
    AgentResult<{
      proof: PaymentProof | null;
      verified: boolean;
      status: string;
    }>
  > {
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
      const paymentStatus = await this.getRpc().getPayment({
        payment_hash: paymentHash as HexString,
      });

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

      const report = this.paymentProofManager.exportAuditReport(
        options?.startTime,
        options?.endTime,
      );

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
  // Hold Invoice & Settlement Methods
  // ===========================================================================

  /**
   * Create a hold invoice (for escrow / conditional payments)
   * The payer's funds are held until you explicitly settle with the preimage,
   * or cancelled if you don't settle before expiry.
   *
   * @example
   * ```typescript
   * const invoice = await fiber.createHoldInvoice({
   *   amountCkb: 10,
   *   paymentHash: '0x...',  // SHA-256 hash of your secret preimage
   *   description: 'Escrow for service',
   * });
   * // Share invoice.data.invoice with the payer
   * // When conditions are met, call settleInvoice() with the preimage
   * ```
   */
  async createHoldInvoice(params: {
    /** Amount to receive in CKB */
    amountCkb: number;
    /** Payment hash (SHA-256 of preimage you control) */
    paymentHash: string;
    /** Description for the payer */
    description?: string;
    /** Expiry time in minutes (default: 60) */
    expiryMinutes?: number;
  }): Promise<AgentResult<HoldInvoiceResult>> {
    this.ensureInitialized();

    try {
      const amountHex = ckbToShannons(params.amountCkb);
      const expirySeconds = (params.expiryMinutes || 60) * 60;
      const holdInvoiceParams: Parameters<FiberRpcClient['newInvoice']>[0] = {
        amount: amountHex,
        currency: this.config.chain === 'mainnet' ? 'Fibb' : 'Fibt',
        description: params.description,
        expiry: toHex(expirySeconds),
        payment_hash: params.paymentHash as HexString,
      };

      let invoiceAddress: string;
      let paymentHash: string;
      if (this.runtimeJobManager) {
        const job = await this.runtimeJobManager.manageInvoice(
          {
            action: 'create',
            newInvoiceParams: holdInvoiceParams,
            waitForTerminal: false,
          },
          { idempotencyKey: `invoice:create:${params.paymentHash}` },
        );
        const terminal = await this.waitForRuntimeJobTerminal(job.id, 120_000);
        if (
          terminal.type !== 'invoice' ||
          terminal.state !== 'succeeded' ||
          !terminal.result?.invoiceAddress ||
          !terminal.result.paymentHash
        ) {
          throw new Error(terminal.error?.message ?? 'Runtime hold invoice job failed');
        }
        invoiceAddress = terminal.result.invoiceAddress;
        paymentHash = terminal.result.paymentHash;
      } else {
        const result = await this.getRpc().newInvoice(holdInvoiceParams);
        invoiceAddress = result.invoice_address;
        paymentHash = result.invoice.data.payment_hash;
      }

      const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();

      const invoiceResult: HoldInvoiceResult = {
        invoice: invoiceAddress,
        paymentHash,
        amountCkb: params.amountCkb,
        expiresAt,
        status: 'open',
      };

      this.policy.addAuditEntry('HOLD_INVOICE_CREATED', true, { ...invoiceResult });

      return {
        success: true,
        data: invoiceResult,
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'HOLD_INVOICE_FAILED', true);
    }
  }

  /**
   * Settle a hold invoice by revealing the preimage
   * This releases the held funds to you. No policy check needed since
   * settling receives money, it doesn't spend it.
   *
   * @example
   * ```typescript
   * await fiber.settleInvoice({
   *   paymentHash: '0x...',
   *   preimage: '0x...',  // The secret preimage whose hash matches paymentHash
   * });
   * ```
   */
  async settleInvoice(params: {
    /** Payment hash of the hold invoice */
    paymentHash: string;
    /** Preimage that hashes to the payment hash */
    preimage: string;
  }): Promise<AgentResult<void>> {
    this.ensureInitialized();

    try {
      if (this.runtimeJobManager) {
        const job = await this.runtimeJobManager.manageInvoice(
          {
            action: 'settle',
            settleInvoiceParams: {
              payment_hash: params.paymentHash as HexString,
              payment_preimage: params.preimage as HexString,
            },
          },
          { idempotencyKey: `invoice:settle:${params.paymentHash}` },
        );
        const terminal = await this.waitForRuntimeJobTerminal(job.id, 120_000);
        if (terminal.type !== 'invoice' || terminal.state !== 'succeeded') {
          throw new Error(terminal.error?.message ?? 'Runtime settle invoice job failed');
        }
      } else {
        await this.getRpc().settleInvoice({
          payment_hash: params.paymentHash as HexString,
          payment_preimage: params.preimage as HexString,
        });
      }

      this.policy.addAuditEntry('HOLD_INVOICE_SETTLED', true, {
        paymentHash: params.paymentHash,
      });

      return {
        success: true,
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'SETTLE_INVOICE_FAILED', true);
    }
  }

  // ===========================================================================
  // Waiting / Watching Methods
  // ===========================================================================

  /**
   * Wait for a payment to complete (Success or Failed)
   * Wraps the SDK-level polling helper with AgentResult return type.
   */
  async waitForPayment(
    paymentHash: string,
    options?: {
      /** Timeout in ms (default: 120000) */
      timeoutMs?: number;
    },
  ): Promise<AgentResult<PaymentResult>> {
    this.ensureInitialized();

    try {
      const result = await this.getRpc().waitForPayment(paymentHash as HexString, {
        timeout: options?.timeoutMs,
      });

      return {
        success: result.status === 'Success',
        data: {
          paymentHash: result.payment_hash,
          status:
            result.status === 'Success'
              ? 'success'
              : result.status === 'Failed'
                ? 'failed'
                : 'pending',
          amountCkb: 0, // Amount not returned from get_payment
          feeCkb: shannonsToCkb(result.fee),
          failureReason: result.failed_error,
        },
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'WAIT_PAYMENT_FAILED', true);
    }
  }

  /**
   * Wait for a channel to become ready (ChannelReady state)
   * Useful after opening a channel — waits for on-chain confirmation.
   */
  async waitForChannelReady(
    channelId: string,
    options?: {
      /** Timeout in ms (default: 300000 = 5 min) */
      timeoutMs?: number;
    },
  ): Promise<AgentResult<ChannelSummary>> {
    this.ensureInitialized();

    try {
      const channel = await this.getRpc().waitForChannelReady(channelId as HexString, {
        timeout: options?.timeoutMs,
      });

      return {
        success: true,
        data: {
          id: channel.channel_id,
          peerId: channel.peer_id,
          localBalanceCkb: shannonsToCkb(channel.local_balance),
          remoteBalanceCkb: shannonsToCkb(channel.remote_balance),
          state: channel.state.state_name,
          isPublic: channel.is_public,
        },
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      return this.errorResult(error, 'WAIT_CHANNEL_FAILED', true);
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
  async canSend(amountCkb: number): Promise<
    AgentResult<{
      canSend: boolean;
      shortfallCkb: number;
      availableCkb: number;
      recommendation: string;
    }>
  > {
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

  private getRpc(): FiberRpcClient {
    if (!this.rpc) {
      throw new Error('RPC client not initialized. Call initialize() first.');
    }
    return this.rpc;
  }

  private async waitForRuntimeJobTerminal(jobId: string, timeoutMs: number): Promise<RuntimeJob> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const job = this.runtimeJobManager?.getJob(jobId);
      if (!job) {
        throw new Error(`Runtime job not found: ${jobId}`);
      }
      if (job.state === 'succeeded' || job.state === 'failed' || job.state === 'cancelled') {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Runtime job ${jobId} timed out after ${timeoutMs}ms`);
  }

  /**
   * Map RPC CkbInvoiceStatus to agent-level status string
   */
  private mapInvoiceStatus(
    status: CkbInvoiceStatus,
  ): 'open' | 'accepted' | 'settled' | 'cancelled' {
    switch (status) {
      case 'Open':
        return 'open';
      case 'Received':
        return 'accepted';
      case 'Paid':
        return 'settled';
      case 'Cancelled':
      case 'Expired':
        return 'cancelled';
      default:
        return 'open';
    }
  }

  private getInvoiceExpiryIso(invoice: CkbInvoice): string {
    // Spec: InvoiceData.timestamp is seconds since UNIX epoch, ExpiryTime attribute is seconds duration.
    try {
      const createdSeconds = fromHex(invoice.data.timestamp as HexString);
      const expiryDeltaSeconds =
        this.getAttributeU64(invoice.data.attrs, 'ExpiryTime') ?? BigInt(60 * 60);
      return new Date(Number(createdSeconds + expiryDeltaSeconds) * 1000).toISOString();
    } catch {
      return '';
    }
  }

  private getAttributeU64(
    attrs: Attribute[],
    key: 'ExpiryTime' | 'FinalHtlcTimeout' | 'FinalHtlcMinimumExpiryDelta',
  ): bigint | undefined {
    for (const attr of attrs) {
      if (key in attr) {
        return fromHex((attr as Record<string, HexString>)[key] as HexString);
      }
    }
    return undefined;
  }

  private errorResult<T>(error: unknown, code: string, recoverable: boolean): AgentResult<T> {
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
  /** Auto-start the Fiber node on initialize (default: true) */
  autoStart?: boolean;
  /** RPC URL to connect to an existing node (overrides autoStart) */
  rpcUrl?: string;
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
    autoStart: options?.autoStart ?? true,
    rpcUrl: options?.rpcUrl,
    keyPassword: options?.keyPassword,
  });
}

// Re-export types for MCP tools
export type { PaymentProof, PaymentProofSummary } from '@fiber-pay/runtime';
