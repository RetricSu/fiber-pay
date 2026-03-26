/**
 * L402 Protocol Module
 *
 * Provides L402 (HTTP 402 + Macaroon + Lightning Invoice) payment
 * protocol support for Express-based APIs on Fiber Network.
 */

export type { MacaroonCaveat, MintParams, VerifyResult } from './macaroon.js';

// Macaroon
export { MacaroonService } from './macaroon.js';
// Middleware
export { createL402Middleware, L402Middleware } from './middleware.js';
// Resources
export { DefaultResourceResolverRegistry } from './resources.js';
// Types
export type {
  ChallengeStore,
  L402Challenge,
  L402Config,
  L402Invoice,
  L402MiddlewareConfig,
  L402Request,
  L402Token,
  ProtectedResourceInfo,
  ResourceResolver,
  ResourceResolverRegistry,
} from './types.js';
