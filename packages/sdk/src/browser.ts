/**
 * @fiber-pay/sdk/browser
 * Browser-safe subset of the Fiber Pay SDK.
 * Excludes Node.js-dependent modules (KeyManager, CorsProxy, PaymentProofManager, InvoiceVerifier).
 *
 * @packageDocumentation
 */

export type { Script } from './address.js';
// Address encoding (pure JS — browser-compatible)
export { scriptToAddress } from './address.js';
// RPC client (uses fetch — browser-compatible)
export { FiberRpcClient, FiberRpcError } from './rpc/index.js';
// Types — all types are compile-time only, always safe
export type * from './types/index.js';
// Utility functions (pure JS — browser-compatible)
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
