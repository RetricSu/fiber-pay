/**
 * L402 Protocol Types
 *
 * Type definitions for the L402 (HTTP 402 + Macaroon + Lightning Invoice)
 * payment protocol. These types are framework-agnostic where possible;
 * Express-specific types are isolated behind optional peer dependency.
 */

import type { Request } from 'express';

// ─── Invoice ───────────────────────────────────────────────
/** Fiber Network invoice used in L402 challenges. */
export interface L402Invoice {
  paymentHash: string;
  invoiceAddress: string; // Fibt/Fibb address
  amount: string; // In shannons (hex)
  description: string;
  expiry: number; // Unix timestamp
  createdAt: number;
}

// ─── L402 Token ────────────────────────────────────────────
/** Authorization token combining macaroon + payment preimage. */
export interface L402Token {
  macaroon: string; // Base64 encoded
  preimage: string; // Hex string
}

// ─── L402 Challenge ────────────────────────────────────────
/** Data returned in a 402 response. */
export interface L402Challenge {
  macaroon: string;
  invoice: string; // Invoice address
}

// ─── L402 Config ───────────────────────────────────────────
/** Core L402 configuration. */
export interface L402Config {
  /** Hex string for macaroon signing (32 bytes / 64 hex chars). */
  rootKey: string;
  /** Default expiry for macaroon + invoice in seconds. Default: 3600. */
  expirySeconds: number;
  /** Default price in CKB. */
  priceCkb: number;
}

// ─── Middleware Types ──────────────────────────────────────

/** Express request augmented with L402 validation result. */
export interface L402Request extends Request {
  l402?: {
    valid: boolean;
    preimage?: string;
    paymentHash?: string;
    token?: L402Token;
  };
}

/** Full middleware configuration including rate limiting. */
export interface L402MiddlewareConfig extends L402Config {
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

/** In-memory challenge store interface. */
export interface ChallengeStore {
  get(key: string): L402Challenge | undefined;
  set(key: string, value: L402Challenge): void;
  delete(key: string): void;
  has(key: string): boolean;
}

// ─── Resource Types ────────────────────────────────────────

/** Metadata about a protected resource (used for dynamic pricing). */
export interface ProtectedResourceInfo {
  id?: string;
  type?: string;
  priceCkb?: number;
}

/** Resolves request → resource info for dynamic pricing. */
export interface ResourceResolver {
  name: string;
  matches(req: Request): boolean;
  resolve(req: Request): Promise<ProtectedResourceInfo | undefined>;
}

/** Registry that matches requests to the appropriate resolver. */
export interface ResourceResolverRegistry {
  register(resolver: ResourceResolver): void;
  resolve(req: Request): Promise<ProtectedResourceInfo | undefined>;
}
