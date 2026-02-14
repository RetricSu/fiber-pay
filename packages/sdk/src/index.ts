/**
 * @fiber-pay/sdk
 * Core SDK for building Fiber Network applications on CKB Lightning
 *
 * @packageDocumentation
 */

export type { Script } from './address.js';
// Address encoding
export { scriptToAddress } from './address.js';
export type { LiquidityReport } from './funds/liquidity-analyzer.js';
// Funds management
export { LiquidityAnalyzer } from './funds/liquidity-analyzer.js';
// Proxy
export { CorsProxy } from './proxy/cors-proxy.js';
// RPC client
export { FiberRpcClient, FiberRpcError } from './rpc/index.js';
export { createKeyManager, KeyManager } from './security/key-manager.js';
// Security components
export { PolicyEngine } from './security/policy-engine.js';
export type * from './types/index.js';
// Types - Re-export all types from types module
export { ChannelState } from './types/index.js';
// Utility functions
export {
  buildMultiaddr,
  buildMultiaddrFromNodeId,
  ckbToShannons,
  fromHex,
  nodeIdToPeerId,
  randomBytes32,
  shannonsToCkb,
  toHex,
} from './utils.js';
export type { InvoiceVerificationResult } from './verification/invoice-verifier.js';
// Verification
export { InvoiceVerifier } from './verification/invoice-verifier.js';
export type { PaymentProof, PaymentProofSummary } from './verification/payment-proof.js';
export { PaymentProofManager } from './verification/payment-proof.js';
