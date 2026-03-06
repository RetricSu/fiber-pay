/**
 * Fiber RPC Client
 * Type-safe JSON-RPC client for Fiber Network Node
 */

import type {
  AbandonChannelParams,
  AcceptChannelParams,
  AcceptChannelResult,
  // Router methods
  BuildRouterParams,
  BuildRouterResult,
  CancelInvoiceParams,
  CancelInvoiceResult,
  Channel,
  ChannelId,
  CkbInvoiceStatus,
  // Peer methods
  ConnectPeerParams,
  ConnectPeerResult,
  DisconnectPeerParams,
  GetInvoiceParams,
  GetInvoiceResult,
  GetPaymentParams,
  GetPaymentResult,
  GraphChannelsParams,
  GraphChannelsResult,
  // Graph methods
  GraphNodesParams,
  GraphNodesResult,
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
  ListChannelsParams,
  ListChannelsResult,
  ListPeersResult,
  // Invoice methods
  NewInvoiceParams,
  NewInvoiceResult,
  // Info methods
  NodeInfoResult,
  // Channel methods
  OpenChannelParams,
  OpenChannelResult,
  ParseInvoiceParams,
  ParseInvoiceResult,
  PaymentHash,
  // Payment methods
  SendPaymentParams,
  SendPaymentResult,
  SendPaymentWithRouterParams,
  SettleInvoiceParams,
  ShutdownChannelParams,
  UpdateChannelParams,
} from '../types/index.js';
import { ChannelState, type HashAlgorithm } from '../types/index.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Mapping from SDK PascalCase HashAlgorithm to FNN RPC snake_case values.
 *
 * Upstream issue: https://github.com/RetricSu/fiber-pay/issues/66
 *
 * The SDK's HashAlgorithm type uses PascalCase ('CkbHash' | 'Sha256')
 * but FNN v0.7.1 RPC expects snake_case ('ckb_hash' | 'sha256').
 */
const HASH_ALGORITHM_MAP: Record<HashAlgorithm, string> = {
  CkbHash: 'ckb_hash',
  Sha256: 'sha256',
};

// =============================================================================
// RPC Client Configuration
// =============================================================================

export interface RpcClientConfig {
  /** RPC endpoint URL */
  url: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Custom headers */
  headers?: Record<string, string>;
  /**
   * Biscuit token for authentication.
   *
   * Prefer server-side usage. In browser apps, avoid embedding long-lived
   * privileged tokens and use a trusted backend/proxy where possible.
   */
  biscuitToken?: string;
}

// =============================================================================
// RPC Error
// =============================================================================

export class FiberRpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'FiberRpcError';
  }

  static fromJsonRpcError(error: JsonRpcError): FiberRpcError {
    return new FiberRpcError(error.code, error.message, error.data);
  }
}

// =============================================================================
// RPC Client
// =============================================================================

export class FiberRpcClient {
  private requestId = 0;
  private config: Required<Pick<RpcClientConfig, 'url' | 'timeout'>> & RpcClientConfig;

  private readonly channelStateAliases: Record<string, ChannelState> = {
    NEGOTIATING_FUNDING: ChannelState.NegotiatingFunding,
    COLLABORATING_FUNDING_TX: ChannelState.CollaboratingFundingTx,
    SIGNING_COMMITMENT: ChannelState.SigningCommitment,
    AWAITING_TX_SIGNATURES: ChannelState.AwaitingTxSignatures,
    AWAITING_CHANNEL_READY: ChannelState.AwaitingChannelReady,
    CHANNEL_READY: ChannelState.ChannelReady,
    SHUTTING_DOWN: ChannelState.ShuttingDown,
    CLOSED: ChannelState.Closed,
  };

  constructor(config: RpcClientConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Make a raw JSON-RPC call
   *
   * Useful for advanced/experimental RPCs not wrapped by convenience methods.
   *
   * @example
   * ```ts
   * const result = await client.call<MyResult>('some_method', [{ foo: 'bar' }]);
   * ```
   */
  async call<TResult>(method: string, params: unknown[] = []): Promise<TResult> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    if (this.config.biscuitToken) {
      headers.Authorization = `Bearer ${this.config.biscuitToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new FiberRpcError(-32000, `HTTP error: ${response.status} ${response.statusText}`);
      }

      const json = (await response.json()) as JsonRpcResponse<TResult>;

      if (json.error) {
        throw FiberRpcError.fromJsonRpcError(json.error);
      }

      if (json.result === undefined) {
        throw new FiberRpcError(-32000, 'Invalid JSON-RPC response: missing result and error');
      }

      return json.result as TResult;
    } catch (error) {
      if (error instanceof FiberRpcError) {
        throw error;
      }
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new FiberRpcError(-32000, 'Request timeout');
        }
        throw new FiberRpcError(-32000, error.message);
      }
      throw new FiberRpcError(-32000, 'Unknown error');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ===========================================================================
  // Peer Module
  // ===========================================================================

  /**
   * Connect to a peer
   */
  async connectPeer(params: ConnectPeerParams): Promise<ConnectPeerResult> {
    return this.call<ConnectPeerResult>('connect_peer', [params]);
  }

  /**
   * Disconnect from a peer
   */
  async disconnectPeer(params: DisconnectPeerParams): Promise<null> {
    return this.call<null>('disconnect_peer', [params]);
  }

  /**
   * List all connected peers
   */
  async listPeers(): Promise<ListPeersResult> {
    return this.call<ListPeersResult>('list_peers', []);
  }

  // ===========================================================================
  // Channel Module
  // ===========================================================================

  /**
   * Open a new channel with a peer
   */
  async openChannel(params: OpenChannelParams): Promise<OpenChannelResult> {
    return this.call<OpenChannelResult>('open_channel', [params]);
  }

  /**
   * Accept a channel opening request
   */
  async acceptChannel(params: AcceptChannelParams): Promise<AcceptChannelResult> {
    return this.call<AcceptChannelResult>('accept_channel', [params]);
  }

  /**
   * List all channels
   */
  async listChannels(params?: ListChannelsParams): Promise<ListChannelsResult> {
    const result = await this.call<ListChannelsResult>('list_channels', params ? [params] : [{}]);
    return {
      ...result,
      channels: result.channels.map((channel) => this.normalizeChannel(channel)),
    };
  }

  private normalizeChannelStateName(stateName: string): ChannelState {
    const alias = this.channelStateAliases[stateName];
    if (alias) return alias;

    const normalizedInput = stateName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    for (const value of Object.values(ChannelState)) {
      const normalizedValue = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (normalizedValue === normalizedInput) {
        return value;
      }
    }

    return stateName as ChannelState;
  }

  private normalizeChannel(channel: Channel): Channel {
    return {
      ...channel,
      state: {
        ...channel.state,
        state_name: this.normalizeChannelStateName(channel.state.state_name),
      },
    };
  }

  /**
   * Shutdown (close) a channel
   */
  async shutdownChannel(params: ShutdownChannelParams): Promise<null> {
    return this.call<null>('shutdown_channel', [params]);
  }

  /**
   * Abandon a pending channel
   */
  async abandonChannel(params: AbandonChannelParams): Promise<null> {
    return this.call<null>('abandon_channel', [params]);
  }

  /**
   * Update channel parameters
   */
  async updateChannel(params: UpdateChannelParams): Promise<null> {
    return this.call<null>('update_channel', [params]);
  }

  // ===========================================================================
  // Payment Module
  // ===========================================================================

  /**
   * Send a payment
   */
  async sendPayment(params: SendPaymentParams): Promise<SendPaymentResult> {
    return this.call<SendPaymentResult>('send_payment', [params]);
  }

  /**
   * Get payment status
   */
  async getPayment(params: GetPaymentParams): Promise<GetPaymentResult> {
    return this.call<GetPaymentResult>('get_payment', [params]);
  }

  // ===========================================================================
  // Invoice Module
  // ===========================================================================

  /**
   * Create a new invoice
   *
   * NOTE: HashAlgorithm value mapping
   *
   * Upstream issue: https://github.com/RetricSu/fiber-pay/issues/66
   *
   * The SDK's HashAlgorithm type uses PascalCase ('CkbHash' | 'Sha256')
   * but FNN v0.7.1 RPC expects snake_case ('ckb_hash' | 'sha256').
   *
   * This mapping ensures compatibility while maintaining backward-compatible
   * SDK types. When upstream fixes this inconsistency, this mapping can
   * be removed.
   */
  async newInvoice(params: NewInvoiceParams): Promise<NewInvoiceResult> {
    const { hash_algorithm, ...rest } = params;
    const rpcParams: Record<string, unknown> = { ...rest };

    if (hash_algorithm) {
      rpcParams.hash_algorithm = HASH_ALGORITHM_MAP[hash_algorithm] ?? hash_algorithm;
    }

    return this.call<NewInvoiceResult>('new_invoice', [rpcParams]);
  }

  /**
   * Parse an invoice string
   */
  async parseInvoice(params: ParseInvoiceParams): Promise<ParseInvoiceResult> {
    return this.call<ParseInvoiceResult>('parse_invoice', [params]);
  }

  /**
   * Get invoice by payment hash
   */
  async getInvoice(params: GetInvoiceParams): Promise<GetInvoiceResult> {
    return this.call<GetInvoiceResult>('get_invoice', [params]);
  }

  /**
   * Cancel an open invoice
   */
  async cancelInvoice(params: CancelInvoiceParams): Promise<CancelInvoiceResult> {
    return this.call<CancelInvoiceResult>('cancel_invoice', [params]);
  }

  /**
   * Settle a hold invoice with the preimage
   * Used for conditional/escrow payments where the invoice was created
   * with a payment_hash (no preimage provided upfront)
   */
  async settleInvoice(params: SettleInvoiceParams): Promise<null> {
    return this.call<null>('settle_invoice', [params]);
  }

  // ===========================================================================
  // Router Module
  // ===========================================================================

  /**
   * Build a custom route for payment
   * Useful for channel rebalancing (circular payments) and advanced routing
   */
  async buildRouter(params: BuildRouterParams): Promise<BuildRouterResult> {
    return this.call<BuildRouterResult>('build_router', [params]);
  }

  /**
   * Send a payment using a pre-built route from buildRouter()
   * Use with allow_self_payment for channel rebalancing
   */
  async sendPaymentWithRouter(params: SendPaymentWithRouterParams): Promise<SendPaymentResult> {
    return this.call<SendPaymentResult>('send_payment_with_router', [params]);
  }

  // ===========================================================================
  // Graph Module
  // ===========================================================================

  /**
   * List nodes in the network graph
   */
  async graphNodes(params?: GraphNodesParams): Promise<GraphNodesResult> {
    return this.call<GraphNodesResult>('graph_nodes', params ? [params] : [{}]);
  }

  /**
   * List channels in the network graph
   */
  async graphChannels(params?: GraphChannelsParams): Promise<GraphChannelsResult> {
    return this.call<GraphChannelsResult>('graph_channels', params ? [params] : [{}]);
  }

  // ===========================================================================
  // Info Module
  // ===========================================================================

  /**
   * Get local node information
   */
  async nodeInfo(): Promise<NodeInfoResult> {
    return this.call<NodeInfoResult>('node_info', []);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Check if the node is reachable
   */
  async ping(): Promise<boolean> {
    try {
      await this.nodeInfo();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for the node to be ready
   */
  async waitForReady(options: { timeout?: number; interval?: number } = {}): Promise<void> {
    const { timeout = 60000, interval = 1000 } = options;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (await this.ping()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new FiberRpcError(-32000, 'Node not ready within timeout');
  }

  // ===========================================================================
  // Polling / Watching Helpers
  // ===========================================================================

  /**
   * Wait for a payment to reach a terminal state (Success or Failed)
   * Polls get_payment at the specified interval.
   *
   * @returns The final payment result
   * @throws FiberRpcError on timeout
   */
  async waitForPayment(
    paymentHash: PaymentHash,
    options: { timeout?: number; interval?: number } = {},
  ): Promise<GetPaymentResult> {
    const { timeout = 120000, interval = 2000 } = options;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await this.getPayment({ payment_hash: paymentHash });
      if (result.status === 'Success' || result.status === 'Failed') {
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new FiberRpcError(-32000, `Payment ${paymentHash} did not complete within ${timeout}ms`);
  }

  /**
   * Wait for a channel to reach ChannelReady state.
   * Polls list_channels at the specified interval.
   *
   * @returns The channel info once ready
   * @throws FiberRpcError on timeout or if channel disappears
   */
  async waitForChannelReady(
    channelId: ChannelId,
    options: { timeout?: number; interval?: number } = {},
  ): Promise<Channel> {
    const { timeout = 300000, interval = 5000 } = options;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await this.listChannels({});
      const channel = result.channels.find((ch) => ch.channel_id === channelId);

      if (!channel) {
        // Channel may use temporary_channel_id initially, check all
        const allChannels = result.channels;
        const found = allChannels.find((ch) => ch.channel_id === channelId);
        if (!found) {
          // Channel not yet visible or was abandoned - keep waiting
          await new Promise((resolve) => setTimeout(resolve, interval));
          continue;
        }
      }

      if (channel && channel.state.state_name === ChannelState.ChannelReady) {
        return channel;
      }

      if (channel && channel.state.state_name === ChannelState.Closed) {
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
   * Useful for hold invoice workflows: wait for 'Received' before settling.
   *
   * @returns The invoice info once the target status is reached
   * @throws FiberRpcError on timeout
   */
  async waitForInvoiceStatus(
    paymentHash: PaymentHash,
    targetStatus: CkbInvoiceStatus | CkbInvoiceStatus[],
    options: { timeout?: number; interval?: number } = {},
  ): Promise<GetInvoiceResult> {
    const { timeout = 120000, interval = 2000 } = options;
    const statuses = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await this.getInvoice({ payment_hash: paymentHash });
      if (statuses.includes(result.status)) {
        return result;
      }
      // If cancelled, stop waiting
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

  /**
   * Watch for incoming payments on specified invoices.
   * Polls invoice statuses and calls the callback when a status changes.
   * Use an AbortSignal to stop watching.
   *
   * @example
   * ```typescript
   * const controller = new AbortController();
   * client.watchIncomingPayments({
   *   paymentHashes: [hash1, hash2],
   *   onPayment: (invoice) => console.log('Payment received!', invoice),
   *   signal: controller.signal,
   * });
   * // Later: controller.abort(); to stop watching
   * ```
   */
  async watchIncomingPayments(options: {
    /** Payment hashes of invoices to watch */
    paymentHashes: PaymentHash[];
    /** Callback when an invoice status changes to Received or Paid */
    onPayment: (invoice: GetInvoiceResult) => void;
    /** Polling interval in ms (default: 3000) */
    interval?: number;
    /** AbortSignal to stop watching */
    signal?: AbortSignal;
  }): Promise<void> {
    const { paymentHashes, onPayment, interval = 3000, signal } = options;
    const knownStatuses = new Map<string, CkbInvoiceStatus>();

    // Initialize known statuses
    for (const hash of paymentHashes) {
      try {
        const invoice = await this.getInvoice({ payment_hash: hash });
        knownStatuses.set(hash, invoice.status);
      } catch {
        knownStatuses.set(hash, 'Open');
      }
    }

    while (!signal?.aborted) {
      for (const hash of paymentHashes) {
        if (signal?.aborted) return;

        try {
          const invoice = await this.getInvoice({ payment_hash: hash });
          const previousStatus = knownStatuses.get(hash);

          if (
            invoice.status !== previousStatus &&
            (invoice.status === 'Received' || invoice.status === 'Paid')
          ) {
            knownStatuses.set(hash, invoice.status);
            onPayment(invoice);
          } else if (invoice.status !== previousStatus) {
            knownStatuses.set(hash, invoice.status);
          }
        } catch {
          // Invoice may not exist yet or node unreachable — skip this round
        }
      }

      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        const timer = setTimeout(resolve, interval);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
}

// =============================================================================
// Re-export utility functions
// =============================================================================

export { ckbToShannons, fromHex, randomBytes32, shannonsToCkb, toHex } from '../utils.js';
