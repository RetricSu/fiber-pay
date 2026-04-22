/**
 * @fiber-pay/sdk/browser
 * Browser-specific entry point for running Fiber WASM nodes
 *
 * This module provides everything needed to run a Fiber payment node
 * directly in the browser via WebAssembly.
 *
 * @packageDocumentation
 */

// =============================================================================
// High-Level API (primary entry for frontend developers)
// =============================================================================

export type {
  BrowserNodeEvents,
  BrowserNodeState,
  FiberBrowserNodeConfig,
  StartOptions,
} from './fiber-browser-node.js';
export { FiberBrowserNode } from './fiber-browser-node.js';

// =============================================================================
// Credential Providers (decoupled key management)
// =============================================================================

export type {
  CredentialProvider,
  PasswordUnlockParams,
  RawKeyUnlockParams,
} from './credential-provider.js';
export * from './passkey-credential-provider.js';
export * from './password-credential-provider.js';
export * from './raw-key-credential-provider.js';

// =============================================================================
// Config Builder (for advanced users who need custom configs)
// =============================================================================

export type { BrowserNodeConfig, UdtWhitelistEntry } from './config-builder.js';
export { ConfigBuilder } from './config-builder.js';

// =============================================================================
// WASM Adapter (low-level, for advanced users)
// =============================================================================

export type {
  FiberWasmFactory,
  FiberWasmInstance,
  WasmAdapterConfig,
  WasmAdapterEvents,
  WasmAdapterState,
} from './wasm-adapter.js';
export { FiberWasmAdapter } from './wasm-adapter.js';

// =============================================================================
// Re-export core SDK types (convenience — no need to import from two paths)
// =============================================================================

export { scriptToAddress } from '../address.js';
export type {
  RpcClientConfig,
  RpcClientConfig as BrowserRpcClientConfig,
} from '../rpc/client.js';
export {
  FiberRpcClient,
  FiberRpcClient as BrowserRpcClient,
  FiberRpcError,
} from '../rpc/client.js';
export { ckbHash, derivePublicKey } from '../security/crypto.js';
export type { IFiberClient } from '../types/fiber-client.js';
export type {
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
  Hash256,
  HexString,
  ListChannelsParams,
  ListChannelsResult,
  ListPeersResult,
  Multiaddr,
  NewInvoiceParams,
  NewInvoiceResult,
  NodeInfoResult,
  OpenChannelParams,
  OpenChannelResult,
  ParseInvoiceParams,
  ParseInvoiceResult,
  PaymentHash,
  PeerId,
  Pubkey,
  SendPaymentParams,
  SendPaymentResult,
  SendPaymentWithRouterParams,
  SettleInvoiceParams,
  ShutdownChannelParams,
  UpdateChannelParams,
} from '../types/rpc.js';
export { ChannelState } from '../types/rpc.js';
export { ckbToShannons, fromHex, shannonsToCkb, toHex } from '../utils.js';
export { callJsonRpc, formatShannonsAsCkb, getLockBalanceShannons } from './ckb-balance.js';
