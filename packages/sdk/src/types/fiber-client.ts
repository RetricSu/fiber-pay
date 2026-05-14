/**
 * IFiberClient — Shared interface for Fiber node clients
 *
 * Both `FiberRpcClient` (JSON-RPC over HTTP) and `FiberBrowserNode`
 * (WASM in-browser) implement this interface, enabling dual-mode apps
 * to switch backends without adapter glue code.
 *
 * @example
 * ```ts
 * import type { IFiberClient } from '@fiber-pay/sdk';
 *
 * async function getBalance(client: IFiberClient) {
 *   const info = await client.nodeInfo();
 *   const channels = await client.listChannels();
 *   // Works identically regardless of RPC vs browser node
 *   return channels;
 * }
 * ```
 */

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
  OpenChannelWithExternalFundingParams,
  OpenChannelWithExternalFundingResult,
  ParseInvoiceParams,
  ParseInvoiceResult,
  PaymentHash,
  SendPaymentParams,
  SendPaymentResult,
  SendPaymentWithRouterParams,
  SettleInvoiceParams,
  ShutdownChannelParams,
  SubmitSignedFundingTxParams,
  SubmitSignedFundingTxResult,
  UpdateChannelParams,
} from './rpc.js';

/**
 * Common client interface shared by FiberRpcClient and FiberBrowserNode.
 *
 * Method names mirror the Fiber RPC spec (`node_info` → `nodeInfo`, etc.).
 * Mutation methods that return nothing in practice use `Promise<void>`
 * for ergonomic TypeScript usage.
 */
export interface IFiberClient {
  // ---------------------------------------------------------------------------
  // Info
  // ---------------------------------------------------------------------------

  /** Get local node information. */
  nodeInfo(): Promise<NodeInfoResult>;

  // ---------------------------------------------------------------------------
  // Peer
  // ---------------------------------------------------------------------------

  /** Connect to a peer. */
  connectPeer(params: ConnectPeerParams): Promise<void>;

  /** Disconnect from a peer. */
  disconnectPeer(params: DisconnectPeerParams): Promise<void>;

  /** List all connected peers. */
  listPeers(): Promise<ListPeersResult>;

  // ---------------------------------------------------------------------------
  // Channel
  // ---------------------------------------------------------------------------

  /** Open a new channel with a peer. */
  openChannel(params: OpenChannelParams): Promise<OpenChannelResult>;

  /** Open a channel where the funding transaction is signed externally by user wallet. */
  openChannelWithExternalFunding(
    params: OpenChannelWithExternalFundingParams,
  ): Promise<OpenChannelWithExternalFundingResult>;

  /** Submit the externally signed funding transaction for an externally funded channel. */
  submitSignedFundingTx(params: SubmitSignedFundingTxParams): Promise<SubmitSignedFundingTxResult>;

  /** Accept a channel opening request. */
  acceptChannel(params: AcceptChannelParams): Promise<AcceptChannelResult>;

  /** List all channels. */
  listChannels(params?: ListChannelsParams): Promise<ListChannelsResult>;

  /** Shutdown (close) a channel. */
  shutdownChannel(params: ShutdownChannelParams): Promise<void>;

  /** Abandon a pending channel. */
  abandonChannel(params: AbandonChannelParams): Promise<void>;

  /** Update channel parameters. */
  updateChannel(params: UpdateChannelParams): Promise<void>;

  // ---------------------------------------------------------------------------
  // Payment
  // ---------------------------------------------------------------------------

  /** Send a payment. */
  sendPayment(params: SendPaymentParams): Promise<SendPaymentResult>;

  /** Get payment status. */
  getPayment(params: GetPaymentParams): Promise<GetPaymentResult>;

  /** Build a custom route for payment. */
  buildRouter(params: BuildRouterParams): Promise<BuildRouterResult>;

  /** Send a payment using a pre-built route. */
  sendPaymentWithRouter(params: SendPaymentWithRouterParams): Promise<SendPaymentResult>;

  // ---------------------------------------------------------------------------
  // Invoice
  // ---------------------------------------------------------------------------

  /** Create a new invoice. */
  newInvoice(params: NewInvoiceParams): Promise<NewInvoiceResult>;

  /** Parse an invoice string. */
  parseInvoice(params: ParseInvoiceParams): Promise<ParseInvoiceResult>;

  /** Get invoice by payment hash. */
  getInvoice(params: GetInvoiceParams): Promise<GetInvoiceResult>;

  /** Cancel an open invoice. */
  cancelInvoice(params: CancelInvoiceParams): Promise<CancelInvoiceResult>;

  /** Settle a hold invoice with the preimage. */
  settleInvoice(params: SettleInvoiceParams): Promise<void>;

  // ---------------------------------------------------------------------------
  // Graph
  // ---------------------------------------------------------------------------

  /** List nodes in the network graph. */
  graphNodes(params?: GraphNodesParams): Promise<GraphNodesResult>;

  /** List channels in the network graph. */
  graphChannels(params?: GraphChannelsParams): Promise<GraphChannelsResult>;

  // ---------------------------------------------------------------------------
  // Polling Helpers
  // ---------------------------------------------------------------------------

  /** Wait for a payment to reach a terminal state (Success or Failed). */
  waitForPayment(
    paymentHash: PaymentHash,
    options?: { timeout?: number; interval?: number },
  ): Promise<GetPaymentResult>;

  /** Wait for a channel to reach ChannelReady state. */
  waitForChannelReady(
    channelId: ChannelId,
    options?: { timeout?: number; interval?: number },
  ): Promise<Channel>;

  /** Wait for an invoice to reach a specific status. */
  waitForInvoiceStatus(
    paymentHash: PaymentHash,
    targetStatus: CkbInvoiceStatus | CkbInvoiceStatus[],
    options?: { timeout?: number; interval?: number },
  ): Promise<GetInvoiceResult>;
}
