/**
 * FiberWasmAdapter — Adapter layer wrapping @nervosnetwork/fiber-js
 *
 * Maps the upstream Fiber WASM API to fiber-pay SDK types, providing:
 * - Strongly-typed RPC methods using existing SDK type definitions
 * - Node lifecycle management (start/stop/state)
 * - Error normalization to FiberRpcError
 * - Event emission for state changes
 *
 * This adapter isolates upstream API changes — if fiber-js API evolves,
 * only this file needs updating.
 */

import { FiberRpcError } from '../rpc/client.js';
import { normalizeChannel } from '../rpc/normalize-channel.js';
import type {
  AbandonChannelParams,
  AcceptChannelParams,
  AcceptChannelResult,
  BuildRouterParams,
  BuildRouterResult,
  CancelInvoiceParams,
  CancelInvoiceResult,
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
  ListPaymentsParams,
  ListPaymentsResult,
  ListPeersResult,
  NewInvoiceParams,
  NewInvoiceResult,
  NodeInfoResult,
  OpenChannelParams,
  OpenChannelResult,
  OpenChannelWithExternalFundingParams,
  OpenChannelWithExternalFundingResult,
  ParseInvoiceParams,
  ParseInvoiceResult,
  SendPaymentParams,
  SendPaymentResult,
  SendPaymentWithRouterParams,
  SettleInvoiceParams,
  ShutdownChannelParams,
  SubmitSignedFundingTxParams,
  SubmitSignedFundingTxResult,
  UpdateChannelParams,
} from '../types/rpc.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Upstream Fiber WASM instance interface.
 * Matches the API surface of @nervosnetwork/fiber-js Fiber class.
 * We define this interface rather than importing the class directly
 * to keep @nervosnetwork/fiber-js as an optional dependency.
 */
export interface FiberWasmInstance {
  start(
    config: string,
    fiberKeyPair: Uint8Array,
    ckbSecretKey?: Uint8Array,
    chainSpec?: string,
    logLevel?: 'trace' | 'debug' | 'info' | 'error',
    databasePrefix?: string,
  ): Promise<void>;
  stop(): Promise<void>;
  invokeCommand(name: string, args?: unknown[]): Promise<unknown>;
}

/**
 * Factory function type for creating Fiber WASM instances.
 * This indirection allows users to provide their own Fiber constructor.
 */
export type FiberWasmFactory = () => FiberWasmInstance;

export type WasmAdapterState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface WasmAdapterEvents {
  stateChange: (state: WasmAdapterState) => void;
  error: (error: Error) => void;
}

export interface WasmAdapterConfig {
  /** Factory to create Fiber WASM instance */
  factory: FiberWasmFactory;
}

// =============================================================================
// Adapter
// =============================================================================

export class FiberWasmAdapter {
  private instance: FiberWasmInstance | null = null;
  private _state: WasmAdapterState = 'stopped';
  private factory: FiberWasmFactory;
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  constructor(config: WasmAdapterConfig) {
    this.factory = config.factory;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  get state(): WasmAdapterState {
    return this._state;
  }

  /**
   * Start the WASM Fiber node.
   */
  async start(params: {
    config: string;
    fiberKeyPair: Uint8Array;
    ckbSecretKey?: Uint8Array;
    chainSpec?: string;
    logLevel?: 'trace' | 'debug' | 'info' | 'error';
    databasePrefix?: string;
  }): Promise<void> {
    if (this._state === 'running' || this._state === 'starting') {
      throw new FiberRpcError(-32000, 'WASM node is already running or starting');
    }

    this.setState('starting');

    try {
      this.instance = this.factory();
      await this.instance.start(
        params.config,
        params.fiberKeyPair,
        params.ckbSecretKey,
        params.chainSpec,
        params.logLevel ?? 'info',
        params.databasePrefix,
      );
      this.setState('running');
    } catch (error) {
      this.setState('error');
      const wrapped = error instanceof Error ? error : new Error(String(error));
      this.emit('error', wrapped);
      throw new FiberRpcError(-32000, `WASM node failed to start: ${wrapped.message}`);
    }
  }

  /**
   * Stop the WASM Fiber node.
   */
  async stop(): Promise<void> {
    if (this._state === 'stopped') {
      return;
    }

    this.setState('stopping');

    try {
      if (this.instance) {
        await this.instance.stop();
        this.instance = null;
      }
    } finally {
      this.setState('stopped');
    }
  }

  // ===========================================================================
  // Raw command invocation
  // ===========================================================================

  /**
   * Invoke a raw RPC command on the WASM node.
   * Prefer the typed methods below for standard operations.
   */
  async invoke<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.instance || this._state !== 'running') {
      throw new FiberRpcError(-32000, 'WASM node is not running');
    }

    try {
      return (await this.instance.invokeCommand(method, params)) as T;
    } catch (error) {
      if (error instanceof FiberRpcError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new FiberRpcError(-32000, `WASM RPC error: ${message}`);
    }
  }

  // ===========================================================================
  // Typed RPC Methods — Peer
  // ===========================================================================

  async connectPeer(params: ConnectPeerParams): Promise<void> {
    await this.invoke('connect_peer', [params]);
  }

  async disconnectPeer(params: DisconnectPeerParams): Promise<void> {
    await this.invoke('disconnect_peer', [params]);
  }

  async listPeers(): Promise<ListPeersResult> {
    return this.invoke<ListPeersResult>('list_peers');
  }

  // ===========================================================================
  // Typed RPC Methods — Channel
  // ===========================================================================

  async openChannel(params: OpenChannelParams): Promise<OpenChannelResult> {
    return this.invoke<OpenChannelResult>('open_channel', [params]);
  }

  async openChannelWithExternalFunding(
    params: OpenChannelWithExternalFundingParams,
  ): Promise<OpenChannelWithExternalFundingResult> {
    return this.invoke<OpenChannelWithExternalFundingResult>('open_channel_with_external_funding', [
      params,
    ]);
  }

  async submitSignedFundingTx(
    params: SubmitSignedFundingTxParams,
  ): Promise<SubmitSignedFundingTxResult> {
    return this.invoke<SubmitSignedFundingTxResult>('submit_signed_funding_tx', [params]);
  }

  async acceptChannel(params: AcceptChannelParams): Promise<AcceptChannelResult> {
    return this.invoke<AcceptChannelResult>('accept_channel', [params]);
  }

  async listChannels(params?: ListChannelsParams): Promise<ListChannelsResult> {
    const result = await this.invoke<ListChannelsResult>('list_channels', [params ?? {}]);
    return {
      ...result,
      channels: result.channels.map((channel) => normalizeChannel(channel)),
    };
  }

  async shutdownChannel(params: ShutdownChannelParams): Promise<void> {
    await this.invoke('shutdown_channel', [params]);
  }

  async abandonChannel(params: AbandonChannelParams): Promise<void> {
    await this.invoke('abandon_channel', [params]);
  }

  async updateChannel(params: UpdateChannelParams): Promise<void> {
    await this.invoke('update_channel', [params]);
  }

  // ===========================================================================
  // Typed RPC Methods — Payment
  // ===========================================================================

  async sendPayment(params: SendPaymentParams): Promise<SendPaymentResult> {
    return this.invoke<SendPaymentResult>('send_payment', [params]);
  }

  async getPayment(params: GetPaymentParams): Promise<GetPaymentResult> {
    return this.invoke<GetPaymentResult>('get_payment', [params]);
  }

  async listPayments(params?: ListPaymentsParams): Promise<ListPaymentsResult> {
    return this.invoke<ListPaymentsResult>('list_payments', [params ?? {}]);
  }

  async buildRouter(params: BuildRouterParams): Promise<BuildRouterResult> {
    return this.invoke<BuildRouterResult>('build_router', [params]);
  }

  async sendPaymentWithRouter(params: SendPaymentWithRouterParams): Promise<SendPaymentResult> {
    return this.invoke<SendPaymentResult>('send_payment_with_router', [params]);
  }

  // ===========================================================================
  // Typed RPC Methods — Invoice
  // ===========================================================================

  async newInvoice(params: NewInvoiceParams): Promise<NewInvoiceResult> {
    return this.invoke<NewInvoiceResult>('new_invoice', [params]);
  }

  async parseInvoice(params: ParseInvoiceParams): Promise<ParseInvoiceResult> {
    return this.invoke<ParseInvoiceResult>('parse_invoice', [params]);
  }

  async getInvoice(params: GetInvoiceParams): Promise<GetInvoiceResult> {
    return this.invoke<GetInvoiceResult>('get_invoice', [params]);
  }

  async cancelInvoice(params: CancelInvoiceParams): Promise<CancelInvoiceResult> {
    return this.invoke<CancelInvoiceResult>('cancel_invoice', [params]);
  }

  async settleInvoice(params: SettleInvoiceParams): Promise<void> {
    await this.invoke('settle_invoice', [params]);
  }

  // ===========================================================================
  // Typed RPC Methods — Info & Graph
  // ===========================================================================

  async nodeInfo(): Promise<NodeInfoResult> {
    return this.invoke<NodeInfoResult>('node_info');
  }

  async graphNodes(params?: GraphNodesParams): Promise<GraphNodesResult> {
    return this.invoke<GraphNodesResult>('graph_nodes', [params ?? {}]);
  }

  async graphChannels(params?: GraphChannelsParams): Promise<GraphChannelsResult> {
    return this.invoke<GraphChannelsResult>('graph_channels', [params ?? {}]);
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  on<K extends keyof WasmAdapterEvents>(event: K, listener: WasmAdapterEvents[K]): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof WasmAdapterEvents>(event: K, listener: WasmAdapterEvents[K]): this {
    this.listeners.get(event)?.delete(listener as (...args: unknown[]) => void);
    return this;
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch {
          // Swallow listener errors to not break internal flow
        }
      }
    }
  }

  private setState(state: WasmAdapterState): void {
    this._state = state;
    this.emit('stateChange', state);
  }
}
