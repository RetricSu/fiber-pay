/**
 * Fiber Network Node RPC Types
 * Type definitions for all JSON-RPC methods exposed by the FNN binary
 */

// =============================================================================
// Common Types
// =============================================================================

/** Hex-encoded string (prefixed with 0x) */
export type HexString = `0x${string}`;

/** Peer ID in libp2p format */
export type PeerId = string;

/** Multiaddr format for network addresses */
export type Multiaddr = string;

/** Channel ID (32-byte hex) */
export type ChannelId = HexString;

/** Payment hash (32-byte hex) */
export type PaymentHash = HexString;

/** Script structure for CKB */
export interface Script {
  code_hash: HexString;
  hash_type: 'type' | 'data' | 'data1' | 'data2';
  args: HexString;
}

/** UDT (User Defined Token) type script */
export type UdtScript = Script | null;

// =============================================================================
// Channel Types
// =============================================================================

export type ChannelState =
  | 'NegotiatingFunding'
  | 'CollaboratingFundingTx'
  | 'SigningCommitment'
  | 'AwaitingChannelReady'
  | 'ChannelReady'
  | 'ShuttingDown'
  | 'Closed';

export interface ChannelInfo {
  channel_id: ChannelId;
  peer_id: PeerId;
  state: {
    state_name: ChannelState;
    state_flags: string[];
  };
  local_balance: HexString;
  remote_balance: HexString;
  offered_tlc_balance: HexString;
  received_tlc_balance: HexString;
  created_at: HexString;
  is_public: boolean;
  local_is_tlc_fee_payer: boolean;
}

// =============================================================================
// Peer Types
// =============================================================================

export interface PeerInfo {
  peer_id: PeerId;
  addresses: Multiaddr[];
  connected: boolean;
  chain_hash?: HexString;
}

// =============================================================================
// Payment Types
// =============================================================================

export type PaymentStatus =
  | 'Created'
  | 'Inflight'
  | 'Success'
  | 'Failed';

export interface PaymentInfo {
  payment_hash: PaymentHash;
  status: PaymentStatus;
  created_at: HexString;
  last_updated_at: HexString;
  failed_error?: string;
  fee: HexString;
}

// =============================================================================
// Invoice Types
// =============================================================================

export type InvoiceStatus =
  | 'Open'
  | 'Cancelled'
  | 'Expired'
  | 'Received'
  | 'Paid';

/**
 * Invoice attribute types as returned by Fiber RPC.
 * Each attribute is an object with a single key indicating the type.
 */
export type InvoiceAttribute =
  | { FinalHtlcTimeout: HexString }
  | { FinalHtlcMinimumExpiryDelta: HexString }
  | { ExpiryTime: HexString }
  | { Description: string }
  | { FallbackAddr: string }
  | { UdtScript: Script }
  | { PayeePublicKey: HexString }  // The payee's node public key!
  | { HashAlgorithm: 'CkbHash' | 'Sha256' }
  | { Feature: string[] }
  | { PaymentSecret: HexString };

/**
 * Invoice data structure containing payment details and attributes
 */
export interface InvoiceData {
  timestamp: HexString;
  payment_hash: PaymentHash;
  attrs: InvoiceAttribute[];
}

/**
 * Full CKB Invoice structure as returned by parse_invoice
 */
export interface CkbInvoice {
  currency: string;
  amount?: HexString;
  signature?: HexString;
  data: InvoiceData;
}

/**
 * Simplified invoice info (flattened for convenience)
 */
export interface InvoiceInfo {
  currency: string;
  amount?: HexString;
  payment_hash: PaymentHash;
  payment_preimage?: HexString;
  description?: string;
  status: InvoiceStatus;
  created_at: HexString;
  expiry?: HexString;
  invoice_address: string;
  /** Full invoice data with attributes (when available from parse_invoice) */
  data?: InvoiceData;
}

// =============================================================================
// Node Types
// =============================================================================

export interface NodeInfo {
  version: string;
  commit_hash: string;
  public_key: HexString;
  peer_id: PeerId;
  addresses: Multiaddr[];
  chain_hash: HexString;
  open_channel_auto_accept_min_ckb_funding_amount: HexString;
  auto_accept_channel_ckb_funding_amount: HexString;
  default_funding_lock_script: Script;
  tlc_expiry_delta: HexString;
  tlc_min_value: HexString;
  tlc_fee_proportional_millionths: HexString;
  channel_count: number;
  pending_channel_count: number;
  peers_count: number;
  udt_cfg_infos: UdtConfigInfo[];
}

export interface UdtConfigInfo {
  name: string;
  script: Script;
  auto_accept_amount?: HexString;
  cell_deps: CellDep[];
}

export interface CellDep {
  type_id?: Script;
  out_point?: OutPoint;
  dep_type: 'code' | 'dep_group';
}

export interface OutPoint {
  tx_hash: HexString;
  index: HexString;
}

// =============================================================================
// Graph Types
// =============================================================================

export interface GraphNode {
  alias: string;
  node_id: HexString;
  addresses: Multiaddr[];
  timestamp: HexString;
  chain_hash: HexString;
}

export interface GraphChannel {
  channel_outpoint: string;
  node1: HexString;
  node2: HexString;
  capacity: HexString;
  udt_type_script?: Script;
  created_timestamp?: HexString;
  last_updated_timestamp_of_node1?: HexString;
  last_updated_timestamp_of_node2?: HexString;
}

// =============================================================================
// RPC Request/Response Types
// =============================================================================

// --- Peer Module ---

export interface ConnectPeerParams {
  address: Multiaddr;
  save?: boolean;
}

export interface ConnectPeerResult {
  peer_id: PeerId;
}

export interface DisconnectPeerParams {
  peer_id: PeerId;
}

export interface ListPeersResult {
  peers: PeerInfo[];
}

// --- Channel Module ---

export interface OpenChannelParams {
  peer_id: PeerId;
  funding_amount: HexString;
  public?: boolean;
  funding_udt_type_script?: Script;
  shutdown_script?: Script;
  commitment_delay_epoch?: HexString;
  commitment_fee_rate?: HexString;
  funding_fee_rate?: HexString;
  tlc_expiry_delta?: HexString;
  tlc_min_value?: HexString;
  tlc_fee_proportional_millionths?: HexString;
  max_tlc_value_in_flight?: HexString;
  max_tlc_number_in_flight?: HexString;
}

export interface OpenChannelResult {
  temporary_channel_id: ChannelId;
}

export interface AcceptChannelParams {
  temporary_channel_id: ChannelId;
  funding_amount?: HexString;
  shutdown_script?: Script;
  max_tlc_value_in_flight?: HexString;
  max_tlc_number_in_flight?: HexString;
}

export interface AcceptChannelResult {
  channel_id: ChannelId;
}

export interface ListChannelsParams {
  peer_id?: PeerId;
}

export interface ListChannelsResult {
  channels: ChannelInfo[];
}

export interface ShutdownChannelParams {
  channel_id: ChannelId;
  close_script?: Script;
  fee_rate?: HexString;
  force?: boolean;
}

export interface AbandonChannelParams {
  channel_id: ChannelId;
}

export interface UpdateChannelParams {
  channel_id: ChannelId;
  enabled?: boolean;
  tlc_expiry_delta?: HexString;
  tlc_minimum_value?: HexString;
  tlc_fee_proportional_millionths?: HexString;
}

// --- Payment Module ---

export interface SendPaymentParams {
  invoice?: string;
  target_pubkey?: HexString;
  amount?: HexString;
  payment_hash?: PaymentHash;
  final_tlc_expiry_delta?: HexString;
  tlc_expiry_limit?: HexString;
  max_fee_amount?: HexString;
  max_parts?: number;
  keysend?: boolean;
  udt_type_script?: Script;
  allow_self_payment?: boolean;
  dry_run?: boolean;
}

export interface SendPaymentResult {
  payment_hash: PaymentHash;
  status: PaymentStatus;
  created_at: HexString;
  last_updated_at: HexString;
  failed_error?: string;
  fee: HexString;
}

export interface GetPaymentParams {
  payment_hash: PaymentHash;
}

export interface GetPaymentResult extends PaymentInfo {}

// --- Invoice Module ---

export interface NewInvoiceParams {
  amount: HexString;
  currency: string;
  description?: string;
  expiry?: HexString;
  fallback_address?: string;
  final_expiry_delta?: HexString;
  final_cltv?: HexString;
  udt_type_script?: Script;
  payment_preimage?: HexString;
  hash_algorithm?: 'sha256' | 'blake2b';
}

export interface NewInvoiceResult {
  invoice_address: string;
  invoice: InvoiceInfo;
}

export interface ParseInvoiceParams {
  invoice: string;
}

export interface ParseInvoiceResult {
  invoice: InvoiceInfo;
}

export interface GetInvoiceParams {
  payment_hash: PaymentHash;
}

export interface GetInvoiceResult extends InvoiceInfo {}

export interface CancelInvoiceParams {
  payment_hash: PaymentHash;
}

// --- Graph Module ---

export interface GraphNodesParams {
  limit?: number;
  after?: HexString;
}

export interface GraphNodesResult {
  nodes: GraphNode[];
  last_cursor?: HexString;
}

export interface GraphChannelsParams {
  limit?: number;
  after?: string;
}

export interface GraphChannelsResult {
  channels: GraphChannel[];
  last_cursor?: string;
}

// --- Info Module ---

export interface NodeInfoResult extends NodeInfo {}

// =============================================================================
// JSON-RPC Types
// =============================================================================

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params: T[];
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}
