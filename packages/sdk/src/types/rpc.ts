/**
 * Fiber Network Node RPC Types (Fiber v0.7.1)
 *
 * The types in this file are intended to align with the upstream RPC spec:
 * https://github.com/nervosnetwork/fiber/blob/v0.7.1/crates/fiber-lib/src/rpc/README.md
 */

// =============================================================================
// Common Types
// =============================================================================

/** Hex-encoded string (prefixed with 0x). The RPC serializes most numeric values as hex strings. */
export type HexString = `0x${string}`;

/** A 256-bit hash digest (Hash256 in the RPC spec). */
export type Hash256 = HexString;

/** Public key for a node (Pubkey in the RPC spec). */
export type Pubkey = HexString;

/** Private key (Privkey in the RPC spec). */
export type Privkey = HexString;

/** Peer ID in libp2p format. */
export type PeerId = string;

/** Multiaddr format for network addresses. */
export type Multiaddr = string;

/** Channel ID (Hash256). */
export type ChannelId = Hash256;

/** Payment hash (Hash256). */
export type PaymentHash = Hash256;

/** Script structure for CKB. */
export interface Script {
  code_hash: HexString;
  hash_type: 'type' | 'data' | 'data1' | 'data2';
  args: HexString;
}

/** Transaction out point. */
export interface OutPoint {
  tx_hash: Hash256;
  index: HexString;
}

/** UDT (User Defined Token) script (UdtScript in the RPC spec). */
export type UdtScript = Script;

// =============================================================================
// Invoice Types
// =============================================================================

export type Currency = 'Fibb' | 'Fibt' | 'Fibd';

export type HashAlgorithm = 'CkbHash' | 'Sha256';

/** Recoverable signature (InvoiceSignature in the RPC spec). */
export type InvoiceSignature = HexString;

/**
 * Invoice attribute types as returned by the RPC.
 * Each attribute is an object with a single key indicating the attribute type.
 */
export type Attribute =
  /** Deprecated since v0.6.0, preserved for compatibility. */
  | { FinalHtlcTimeout: HexString }
  /** Final TLC minimum expiry delta in milliseconds. */
  | { FinalHtlcMinimumExpiryDelta: HexString }
  /** Invoice expiry time in seconds. */
  | { ExpiryTime: HexString }
  /** Human-readable invoice description. */
  | { Description: string }
  /** Fallback address for on-chain settlement. */
  | { FallbackAddr: string }
  /** UDT script for token invoices. */
  | { UdtScript: UdtScript }
  /** Payee public key. */
  | { PayeePublicKey: Pubkey }
  /** Hash algorithm used in the payment hash lock. */
  | { HashAlgorithm: HashAlgorithm }
  /** Feature flags list. */
  | { Feature: string[] }
  /** Payment secret. */
  | { PaymentSecret: Hash256 };

export interface InvoiceData {
  timestamp: HexString;
  payment_hash: PaymentHash;
  attrs: Attribute[];
}

export interface CkbInvoice {
  currency: Currency;
  amount?: HexString;
  signature?: InvoiceSignature;
  data: InvoiceData;
}

export type CkbInvoiceStatus = 'Open' | 'Cancelled' | 'Expired' | 'Received' | 'Paid';

// =============================================================================
// Channel Types
// =============================================================================

export enum ChannelState {
  NegotiatingFunding = 'NEGOTIATING_FUNDING',
  CollaboratingFundingTx = 'COLLABORATING_FUNDING_TX',
  SigningCommitment = 'SIGNING_COMMITMENT',
  AwaitingTxSignatures = 'AWAITING_TX_SIGNATURES',
  AwaitingChannelReady = 'AWAITING_CHANNEL_READY',
  ChannelReady = 'CHANNEL_READY',
  ShuttingDown = 'SHUTTING_DOWN',
  Closed = 'CLOSED',
}

/** Channel state flags are serialized as flag names by upstream RPC and may evolve. */
export type ChannelStateFlags = string[];

/** TLC status. The upstream spec defines OutboundTlcStatus / InboundTlcStatus, which may evolve. */
export type TlcStatus = { Outbound: unknown } | { Inbound: unknown };

export interface Htlc {
  id: HexString;
  amount: HexString;
  payment_hash: PaymentHash;
  expiry: HexString;
  forwarding_channel_id?: Hash256;
  forwarding_tlc_id?: HexString;
  status: TlcStatus;
}

export interface Channel {
  channel_id: ChannelId;
  is_public: boolean;
  is_acceptor: boolean;
  is_one_way: boolean;
  channel_outpoint: OutPoint | null;
  peer_id: PeerId;
  funding_udt_type_script: Script | null;
  state: {
    state_name: ChannelState;
    state_flags?: ChannelStateFlags;
  };
  local_balance: HexString;
  offered_tlc_balance: HexString;
  remote_balance: HexString;
  received_tlc_balance: HexString;
  pending_tlcs: Htlc[];
  latest_commitment_transaction_hash: Hash256 | null;
  created_at: HexString;
  enabled: boolean;
  tlc_expiry_delta: HexString;
  tlc_fee_proportional_millionths: HexString;
  shutdown_transaction_hash: Hash256 | null;
  failure_detail?: string;
}

// =============================================================================
// Peer Types
// =============================================================================

export interface PeerInfo {
  pubkey: Pubkey;
  peer_id: PeerId;
  address: Multiaddr;
}

// =============================================================================
// Payment Types
// =============================================================================

export type PaymentStatus = 'Created' | 'Inflight' | 'Success' | 'Failed';

/**
 * Custom records for payments.
 *
 * Keys are hex-encoded u32 values (e.g. `0x1`, range 0..=65535),
 * values are hex-encoded byte arrays (0x-prefixed).
 */
export type PaymentCustomRecords = Record<string, HexString>;

export interface SessionRouteNode {
  pubkey: Pubkey;
  amount: HexString;
  channel_outpoint: OutPoint;
}

export interface SessionRoute {
  nodes: SessionRouteNode[];
}

export interface PaymentInfo {
  payment_hash: PaymentHash;
  status: PaymentStatus;
  created_at: HexString;
  last_updated_at: HexString;
  failed_error?: string;
  fee: HexString;
  custom_records?: PaymentCustomRecords;
  routers?: SessionRoute[];
}

export interface HopHint {
  pubkey: Pubkey;
  channel_outpoint: OutPoint;
  fee_rate: HexString;
  tlc_expiry_delta: HexString;
}

// =============================================================================
// Node / UDT Types
// =============================================================================

export interface UdtCellDep {
  out_point: OutPoint;
  dep_type: 'code' | 'dep_group';
}

export interface UdtDep {
  cell_dep?: UdtCellDep | null;
  type_id?: Script | null;
}

export interface UdtArgInfo {
  name: string;
  script: UdtScript;
  auto_accept_amount?: HexString;
  cell_deps: UdtDep[];
}

export type UdtCfgInfos = UdtArgInfo[];

export interface NodeInfo {
  version: string;
  commit_hash: string;
  node_id: Pubkey;
  features: string[];
  node_name: string | null;
  addresses: Multiaddr[];
  chain_hash: Hash256;
  open_channel_auto_accept_min_ckb_funding_amount: HexString;
  auto_accept_channel_ckb_funding_amount: HexString;
  default_funding_lock_script: Script;
  tlc_expiry_delta: HexString;
  tlc_min_value: HexString;
  tlc_fee_proportional_millionths: HexString;
  channel_count: HexString;
  pending_channel_count: HexString;
  peers_count: HexString;
  udt_cfg_infos: UdtCfgInfos;
}

// =============================================================================
// Graph Types
// =============================================================================

export interface ChannelUpdateInfo {
  timestamp: HexString;
  enabled: boolean;
  outbound_liquidity?: HexString;
  tlc_expiry_delta: HexString;
  tlc_minimum_value: HexString;
  fee_rate: HexString;
}

export interface GraphNodeInfo {
  node_name: string;
  version: string;
  addresses: Multiaddr[];
  features: string[];
  node_id: Pubkey;
  timestamp: HexString;
  chain_hash: Hash256;
  auto_accept_min_ckb_funding_amount: HexString;
  udt_cfg_infos: UdtCfgInfos;
}

export interface GraphChannelInfo {
  channel_outpoint: OutPoint;
  node1: Pubkey;
  node2: Pubkey;
  created_timestamp: HexString;
  update_info_of_node1?: ChannelUpdateInfo | null;
  update_info_of_node2?: ChannelUpdateInfo | null;
  capacity: HexString;
  chain_hash: Hash256;
  udt_type_script?: Script | null;
}

// =============================================================================
// RPC Request/Response Types
// =============================================================================

// --- Peer Module ---

export interface ConnectPeerParams {
  address: Multiaddr;
  save?: boolean;
}

/** connect_peer returns null. */
export type ConnectPeerResult = null;

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
  one_way?: boolean;
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
  funding_amount: HexString;
  shutdown_script?: Script;
  max_tlc_value_in_flight?: HexString;
  max_tlc_number_in_flight?: HexString;
  tlc_min_value?: HexString;
  tlc_fee_proportional_millionths?: HexString;
  tlc_expiry_delta?: HexString;
}

export interface AcceptChannelResult {
  channel_id: ChannelId;
}

export interface ListChannelsParams {
  peer_id?: PeerId;
  include_closed?: boolean;
  only_pending?: boolean;
}

export interface ListChannelsResult {
  channels: Channel[];
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
  target_pubkey?: Pubkey;
  amount?: HexString;
  payment_hash?: PaymentHash;
  final_tlc_expiry_delta?: HexString;
  tlc_expiry_limit?: HexString;
  invoice?: string;
  timeout?: HexString;
  max_fee_amount?: HexString;
  max_fee_rate?: HexString;
  max_parts?: HexString;
  trampoline_hops?: Pubkey[];
  keysend?: boolean;
  udt_type_script?: Script;
  allow_self_payment?: boolean;
  custom_records?: PaymentCustomRecords;
  hop_hints?: HopHint[];
  dry_run?: boolean;
}

export interface SendPaymentResult extends PaymentInfo {}

export interface GetPaymentParams {
  payment_hash: PaymentHash;
}

export interface GetPaymentResult extends PaymentInfo {}

// --- Invoice Module ---

export interface NewInvoiceParams {
  amount: HexString;
  description?: string;
  currency: Currency;
  payment_preimage?: Hash256;
  payment_hash?: PaymentHash;
  expiry?: HexString;
  fallback_address?: string;
  final_expiry_delta?: HexString;
  udt_type_script?: Script;
  hash_algorithm?: HashAlgorithm;
  allow_mpp?: boolean;
  allow_trampoline_routing?: boolean;
}

export interface NewInvoiceResult {
  invoice_address: string;
  invoice: CkbInvoice;
}

export interface ParseInvoiceParams {
  invoice: string;
}

export interface ParseInvoiceResult {
  invoice: CkbInvoice;
}

export interface GetInvoiceParams {
  payment_hash: PaymentHash;
}

export interface GetInvoiceResult {
  invoice_address: string;
  invoice: CkbInvoice;
  status: CkbInvoiceStatus;
}

export interface CancelInvoiceParams {
  payment_hash: PaymentHash;
}

export interface CancelInvoiceResult {
  invoice_address: string;
  invoice: CkbInvoice;
  status: CkbInvoiceStatus;
}

export interface SettleInvoiceParams {
  payment_hash: PaymentHash;
  payment_preimage: Hash256;
}

// --- Router Module ---

export interface HopRequire {
  pubkey: Pubkey;
  channel_outpoint?: OutPoint | null;
}

export interface BuildRouterParams {
  amount?: HexString;
  udt_type_script?: Script;
  hops_info: HopRequire[];
  final_tlc_expiry_delta?: HexString;
}

export interface RouterHop {
  target: Pubkey;
  channel_outpoint: OutPoint;
  amount_received: HexString;
  incoming_tlc_expiry: HexString;
}

export interface BuildRouterResult {
  router_hops: RouterHop[];
}

export interface SendPaymentWithRouterParams {
  payment_hash?: PaymentHash;
  router: RouterHop[];
  invoice?: string;
  custom_records?: PaymentCustomRecords;
  keysend?: boolean;
  udt_type_script?: Script;
  dry_run?: boolean;
}

// --- Graph Module ---

export interface GraphNodesParams {
  limit?: HexString;
  after?: HexString;
}

export interface GraphNodesResult {
  nodes: GraphNodeInfo[];
  last_cursor: HexString;
}

export interface GraphChannelsParams {
  limit?: HexString;
  after?: HexString;
}

export interface GraphChannelsResult {
  channels: GraphChannelInfo[];
  last_cursor: HexString;
}

// =============================================================================
// Additional Upstream RPC Types (for advanced custom call usage)
// =============================================================================

/** Cross-chain hub invoice variant. */
export type CchInvoice = { Fiber: string } | { Lightning: string };

/** Cross-chain hub order status. */
export type CchOrderStatus =
  | 'Pending'
  | 'IncomingAccepted'
  | 'OutgoingInFlight'
  | 'OutgoingSucceeded'
  | 'Succeeded'
  | 'Failed';

/** Reason for removing a TLC in Dev module APIs. */
export type RemoveTlcReason = { RemoveTlcFulfill: Hash256 } | { RemoveTlcFail: HexString };

/** TLC id wrapper in watchtower-related types. */
export type TLCId = { Offered: HexString } | { Received: HexString };

/** Minimal CKB cell output representation used by watchtower revocation data. */
export interface CellOutput {
  capacity: HexString;
  lock: Script;
  type?: Script | null;
}

/** Settlement TLC data used by watchtower operations. */
export interface SettlementTlc {
  tlc_id: TLCId;
  hash_algorithm: HashAlgorithm;
  payment_amount: HexString;
  payment_hash: Hash256;
  expiry: HexString;
  local_key: Privkey;
  remote_key: Pubkey;
}

/** Settlement data used by watchtower operations. */
export interface SettlementData {
  local_amount: HexString;
  remote_amount: HexString;
  tlcs: SettlementTlc[];
}

/** Revocation data used by watchtower operations. */
export interface RevocationData {
  commitment_number: HexString;
  aggregated_signature: HexString;
  output: CellOutput;
  output_data: HexString;
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
