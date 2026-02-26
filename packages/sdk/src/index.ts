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
// RPC client
export { FiberRpcClient, FiberRpcError } from './rpc/index.js';
// Crypto utilities
export {
  AUTH_TAG_LENGTH,
  decryptKey,
  derivePublicKey,
  ENCRYPTED_MAGIC,
  generatePrivateKey,
  IV_LENGTH,
  isEncryptedKey,
  KEY_LENGTH,
  SALT_LENGTH,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
} from './security/crypto.js';
// Security components
export { PolicyEngine } from './security/policy-engine.js';
export type * from './types/index.js';
// Types - Re-export all types from types module
export { ChannelState } from './types/index.js';
// Utility functions
export {
  buildMultiaddr,
  buildMultiaddrFromNodeId,
  buildMultiaddrFromRpcUrl,
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
