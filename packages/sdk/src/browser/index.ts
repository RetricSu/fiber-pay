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
export { normalizeChannel, normalizeChannelStateName } from '../rpc/normalize-channel.js';
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
  CellDep,
  Channel,
  ChannelId,
  CkbInvoiceStatus,
  CkbTransaction,
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
  OpenChannelWithExternalFundingParams,
  OpenChannelWithExternalFundingResult,
  ParseInvoiceParams,
  ParseInvoiceResult,
  PaymentHash,
  PeerId,
  Pubkey,
  Script,
  SendPaymentParams,
  SendPaymentResult,
  SendPaymentWithRouterParams,
  SettleInvoiceParams,
  ShutdownChannelParams,
  SubmitSignedFundingTxParams,
  SubmitSignedFundingTxResult,
  TransportType,
  UpdateChannelParams,
} from '../types/rpc.js';
export { ChannelState } from '../types/rpc.js';
export { ckbToShannons, fromHex, shannonsToCkb, toHex } from '../utils.js';
export {
  type CccExternalFundingResolved,
  type CccFundingSignerLike,
  type CccKnownScriptCellDepLike,
  type CccKnownScriptInfoLike,
  type CccRecommendedAddressObjLike,
  type CccScriptLike,
  type CccSignerLike,
  type CreateCccExternalFundingResolverOptions,
  type CreateCccSignFundingTxOptions,
  cccScriptToFiberScript,
  createCccExternalFundingResolver,
  createCccSignFundingTx,
  resolveFundingLockCellDepsByKnownScript,
} from './ccc-external-funding.js';
export { callJsonRpc, formatShannonsAsCkb, getLockBalanceShannons } from './ckb-balance.js';
export {
  normalizeCkbTransactionForCcc,
  normalizeCkbTransactionForRpc,
} from './ckb-transaction-normalizer.js';
export {
  computeSuggestedFundingAmountCkb,
  type DiagnoseExternalFundingFailureOptions,
  type DiagnoseExternalFundingFailureResult,
  diagnoseExternalFundingFailure,
  extractRequiredCapacityCkbFromFundingError,
  shouldDiagnoseFundingAbortError,
} from './external-funding-diagnostics.js';
export {
  type OpenChannelWithExternalFundingFlowOptions,
  type OpenChannelWithExternalFundingFlowResult,
  openChannelWithExternalFundingFlow,
} from './external-funding-flow.js';
