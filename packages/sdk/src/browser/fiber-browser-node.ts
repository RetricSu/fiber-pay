/**
 * FiberBrowserNode — High-level API for running a Fiber node in the browser
 *
 * This is the primary entry point for frontend developers. It orchestrates:
 * - Credential management (unlock → derive keys)
 * - Config generation (network defaults → YAML)
 * - WASM node lifecycle (init → start → stop)
 * - All RPC operations (payments, channels, invoices, etc.)
 *
 * @example
 * ```ts
 * import { FiberBrowserNode, PasswordCredentialProvider } from '@fiber-pay/sdk/browser';
 *
 * const node = new FiberBrowserNode({
 *   network: 'testnet',
 *   credential: new PasswordCredentialProvider('my-wallet'),
 * });
 *
 * await node.start({ password: 'user-secret' });
 * const info = await node.getNodeInfo();
 * console.log('Node ID:', info.node_id);
 *
 * await node.sendPayment({ invoice: 'fibt1...' });
 * await node.stop();
 * ```
 */

import { FiberRpcError } from '../rpc/client.js';
import type {
  AbandonChannelParams,
  AcceptChannelParams,
  AcceptChannelResult,
  BuildRouterParams,
  BuildRouterResult,
  CancelInvoiceParams,
  CancelInvoiceResult,
  Channel,
  ChannelId,
  CkbInvoiceStatus,
  ConnectPeerParams,
  DisconnectPeerParams,
  GetInvoiceParams,
  GetInvoiceResult,
  GetPaymentParams,
  GetPaymentResult,
  GraphChannelsParams,
  GraphChannelsResult,
  GraphNodesParams,
  GraphNodesResult,
  ListChannelsParams,
  ListChannelsResult,
  ListPeersResult,
  NewInvoiceParams,
  NewInvoiceResult,
  NodeInfoResult,
  OpenChannelParams,
  OpenChannelResult,
  ParseInvoiceParams,
  ParseInvoiceResult,
  PaymentHash,
  SendPaymentParams,
  SendPaymentResult,
  SendPaymentWithRouterParams,
  ShutdownChannelParams,
  UpdateChannelParams,
} from '../types/rpc.js';
import { ChannelState } from '../types/rpc.js';
import type { BrowserNodeConfig } from './config-builder.js';
import { ConfigBuilder } from './config-builder.js';
import type { CredentialProvider, PasswordUnlockParams } from './credential-provider.js';
import type { FiberWasmFactory, WasmAdapterState } from './wasm-adapter.js';
import { FiberWasmAdapter } from './wasm-adapter.js';

// =============================================================================
// Types
// =============================================================================

export type BrowserNodeState =
  | 'idle'
  | 'unlocking'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface FiberBrowserNodeConfig {
  /** Network configuration */
  network: 'testnet' | 'mainnet';
  /** Credential provider for key management */
  credential: CredentialProvider;
  /**
   * Factory to create Fiber WASM instance.
   * If not provided, will attempt to import @nervosnetwork/fiber-js dynamically.
   */
  wasmFactory?: FiberWasmFactory;
  /** Additional network config overrides */
  nodeConfig?: Partial<Omit<BrowserNodeConfig, 'network'>>;
}

export interface StartOptions {
  /** Password for PasswordCredentialProvider (ignored for other providers) */
  password?: string;
  /** Any additional unlock params for custom credential providers */
  unlockParams?: unknown;
}

export interface BrowserNodeEvents {
  stateChange: (state: BrowserNodeState) => void;
  error: (error: Error) => void;
}

// =============================================================================
// FiberBrowserNode
// =============================================================================

export class FiberBrowserNode {
  private config: FiberBrowserNodeConfig;
  private adapter: FiberWasmAdapter | null = null;
  private _state: BrowserNodeState = 'idle';
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  constructor(config: FiberBrowserNodeConfig) {
    this.config = config;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Current node state */
  get state(): BrowserNodeState {
    return this._state;
  }

  /** Whether the node is currently running and ready for RPC calls */
  get isRunning(): boolean {
    return this._state === 'running';
  }

  /**
   * Start the browser Fiber node.
   *
   * This orchestrates the full startup sequence:
   * 1. Unlock credential provider (may require user input, e.g. password)
   * 2. Generate WASM config YAML from network defaults
   * 3. Initialize and start the WASM node
   *
   * After start(), all RPC methods are available and signing is automatic.
   */
  async start(options: StartOptions = {}): Promise<NodeInfoResult> {
    if (this._state === 'running' || this._state === 'starting') {
      throw new FiberRpcError(-32000, 'Node is already running or starting');
    }

    try {
      // Step 1: Unlock credentials
      this.setState('unlocking');
      const credential = this.config.credential;

      if (!credential.isUnlocked()) {
        const unlockParams =
          options.unlockParams ??
          (options.password ? ({ password: options.password } as PasswordUnlockParams) : undefined);
        await credential.unlock(unlockParams);
      }

      const fiberKeyPair = await credential.getFiberKeyPair();
      const ckbSecretKey = await credential.getCkbSecretKey();

      // Step 2: Build config
      this.setState('starting');
      const nodeConfig: BrowserNodeConfig = {
        network: this.config.network,
        ...this.config.nodeConfig,
      };
      const configYaml = ConfigBuilder.build(nodeConfig);

      // Step 3: Create adapter and start WASM node
      const factory = this.config.wasmFactory ?? (await this.loadDefaultFactory());

      this.adapter = new FiberWasmAdapter({ factory });

      // Forward adapter events
      this.adapter.on('error', (error: Error) => {
        this.emit('error', error);
      });

      this.adapter.on('stateChange', (adapterState: WasmAdapterState) => {
        if (adapterState === 'error') {
          this.setState('error');
        }
      });

      const databasePrefix = nodeConfig.databasePrefix ?? `/wasm-${credential.getIdentifier()}`;

      await this.adapter.start({
        config: configYaml,
        fiberKeyPair,
        ckbSecretKey,
        logLevel: nodeConfig.logLevel ?? 'info',
        databasePrefix,
      });

      this.setState('running');

      // Return node info as confirmation
      return await this.adapter.nodeInfo();
    } catch (error) {
      this.setState('error');
      // Ensure keys are wiped if start fails
      await this.config.credential.lock();
      if (this.adapter) {
        await this.adapter.stop().catch(() => {});
        this.adapter = null;
      }

      if (error instanceof FiberRpcError) {
        throw error;
      }
      throw new FiberRpcError(
        -32000,
        `Failed to start browser node: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Stop the browser Fiber node.
   * Locks the credential provider to wipe keys from memory.
   */
  async stop(): Promise<void> {
    if (this._state === 'idle' || this._state === 'stopped') {
      return;
    }

    this.setState('stopping');

    try {
      if (this.adapter) {
        await this.adapter.stop();
        this.adapter = null;
      }
    } finally {
      await this.config.credential.lock();
      this.setState('stopped');
    }
  }

  // ===========================================================================
  // RPC Methods — convenience proxies to adapter
  // ===========================================================================

  private ensureRunning(): FiberWasmAdapter {
    if (!this.adapter || this._state !== 'running') {
      throw new FiberRpcError(-32000, 'Node is not running. Call start() first.');
    }
    return this.adapter;
  }

  // --- Info ---

  async getNodeInfo(): Promise<NodeInfoResult> {
    return this.ensureRunning().nodeInfo();
  }

  // --- Peer ---

  async connectPeer(params: ConnectPeerParams): Promise<void> {
    return this.ensureRunning().connectPeer(params);
  }

  async disconnectPeer(params: DisconnectPeerParams): Promise<void> {
    return this.ensureRunning().disconnectPeer(params);
  }

  async listPeers(): Promise<ListPeersResult> {
    return this.ensureRunning().listPeers();
  }

  // --- Channel ---

  async openChannel(params: OpenChannelParams): Promise<OpenChannelResult> {
    return this.ensureRunning().openChannel(params);
  }

  async acceptChannel(params: AcceptChannelParams): Promise<AcceptChannelResult> {
    return this.ensureRunning().acceptChannel(params);
  }

  async listChannels(params?: ListChannelsParams): Promise<ListChannelsResult> {
    return this.ensureRunning().listChannels(params);
  }

  async shutdownChannel(params: ShutdownChannelParams): Promise<void> {
    return this.ensureRunning().shutdownChannel(params);
  }

  async abandonChannel(params: AbandonChannelParams): Promise<void> {
    return this.ensureRunning().abandonChannel(params);
  }

  async updateChannel(params: UpdateChannelParams): Promise<void> {
    return this.ensureRunning().updateChannel(params);
  }

  // --- Payment ---

  async sendPayment(params: SendPaymentParams): Promise<SendPaymentResult> {
    return this.ensureRunning().sendPayment(params);
  }

  async getPayment(params: GetPaymentParams): Promise<GetPaymentResult> {
    return this.ensureRunning().getPayment(params);
  }

  async buildRouter(params: BuildRouterParams): Promise<BuildRouterResult> {
    return this.ensureRunning().buildRouter(params);
  }

  async sendPaymentWithRouter(params: SendPaymentWithRouterParams): Promise<SendPaymentResult> {
    return this.ensureRunning().sendPaymentWithRouter(params);
  }

  // --- Invoice ---

  async newInvoice(params: NewInvoiceParams): Promise<NewInvoiceResult> {
    return this.ensureRunning().newInvoice(params);
  }

  async parseInvoice(params: ParseInvoiceParams): Promise<ParseInvoiceResult> {
    return this.ensureRunning().parseInvoice(params);
  }

  async getInvoice(params: GetInvoiceParams): Promise<GetInvoiceResult> {
    return this.ensureRunning().getInvoice(params);
  }

  async cancelInvoice(params: CancelInvoiceParams): Promise<CancelInvoiceResult> {
    return this.ensureRunning().cancelInvoice(params);
  }

  // --- Graph ---

  async graphNodes(params?: GraphNodesParams): Promise<GraphNodesResult> {
    return this.ensureRunning().graphNodes(params);
  }

  async graphChannels(params?: GraphChannelsParams): Promise<GraphChannelsResult> {
    return this.ensureRunning().graphChannels(params);
  }

  // ===========================================================================
  // High-Level Helpers
  // ===========================================================================

  /**
   * Wait for a payment to reach a terminal state (Success or Failed).
   */
  async waitForPayment(
    paymentHash: PaymentHash,
    options: { timeout?: number; interval?: number } = {},
  ): Promise<GetPaymentResult> {
    const adapter = this.ensureRunning();
    const { timeout = 120000, interval = 2000 } = options;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await adapter.getPayment({ payment_hash: paymentHash });
      if (result.status === 'Success' || result.status === 'Failed') {
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new FiberRpcError(-32000, `Payment ${paymentHash} did not complete within ${timeout}ms`);
  }

  /**
   * Wait for a channel to reach ChannelReady state.
   */
  async waitForChannelReady(
    channelId: ChannelId,
    options: { timeout?: number; interval?: number } = {},
  ): Promise<Channel> {
    const adapter = this.ensureRunning();
    const { timeout = 300000, interval = 5000 } = options;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await adapter.listChannels({});
      const channel = result.channels.find((ch) => ch.channel_id === channelId);

      if (channel?.state.state_name === ChannelState.ChannelReady) {
        return channel;
      }

      if (channel?.state.state_name === ChannelState.Closed) {
        throw new FiberRpcError(-32000, `Channel ${channelId} was closed before becoming ready`);
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new FiberRpcError(
      -32000,
      `Channel ${channelId} did not become ready within ${timeout}ms`,
    );
  }

  /**
   * Wait for an invoice to reach a specific status.
   */
  async waitForInvoiceStatus(
    paymentHash: PaymentHash,
    targetStatus: CkbInvoiceStatus | CkbInvoiceStatus[],
    options: { timeout?: number; interval?: number } = {},
  ): Promise<GetInvoiceResult> {
    const adapter = this.ensureRunning();
    const { timeout = 120000, interval = 2000 } = options;
    const statuses = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await adapter.getInvoice({ payment_hash: paymentHash });
      if (statuses.includes(result.status)) {
        return result;
      }
      if (result.status === 'Cancelled') {
        throw new FiberRpcError(-32000, `Invoice ${paymentHash} was cancelled`);
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new FiberRpcError(
      -32000,
      `Invoice ${paymentHash} did not reach status [${statuses.join(', ')}] within ${timeout}ms`,
    );
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  on<K extends keyof BrowserNodeEvents>(event: K, listener: BrowserNodeEvents[K]): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof BrowserNodeEvents>(event: K, listener: BrowserNodeEvents[K]): this {
    this.listeners.get(event)?.delete(listener as (...args: unknown[]) => void);
    return this;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch {
          // Swallow listener errors
        }
      }
    }
  }

  private setState(state: BrowserNodeState): void {
    this._state = state;
    this.emit('stateChange', state);
  }

  /**
   * Attempt to dynamically import @nervosnetwork/fiber-js.
   * This allows the package to remain an optional peer dependency.
   */
  private async loadDefaultFactory(): Promise<FiberWasmFactory> {
    try {
      // Dynamic import — will fail if @nervosnetwork/fiber-js is not installed
      const module = await import(/* @vite-ignore */ '@nervosnetwork/fiber-js');
      const FiberClass = module.Fiber ?? module.default?.Fiber ?? module.default;

      if (!FiberClass) {
        throw new Error('Could not find Fiber class in @nervosnetwork/fiber-js');
      }

      return () => new FiberClass();
    } catch (_error) {
      throw new FiberRpcError(
        -32000,
        '@nervosnetwork/fiber-js is not installed. ' +
          'Install it with: npm install @nervosnetwork/fiber-js\n' +
          'Or provide a custom wasmFactory in FiberBrowserNode config.',
      );
    }
  }
}
