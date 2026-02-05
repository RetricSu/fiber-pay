/**
 * Security Policy Types
 * Configuration for AI agent spending limits and guardrails
 */

import { z } from 'zod';
import type { HexString, PeerId, Script } from './rpc.js';

// =============================================================================
// Policy Configuration Schema
// =============================================================================

export const SpendingLimitSchema = z.object({
  /** Maximum amount per single transaction (in shannons for CKB, or base units for UDT) */
  maxPerTransaction: z.string().regex(/^0x[0-9a-fA-F]+$/),
  /** Maximum total amount per time window */
  maxPerWindow: z.string().regex(/^0x[0-9a-fA-F]+$/),
  /** Time window in seconds */
  windowSeconds: z.number().positive(),
  /** Current spent amount in window (runtime state) */
  currentSpent: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  /** Window start timestamp (runtime state) */
  windowStart: z.number().optional(),
});

export type SpendingLimit = z.infer<typeof SpendingLimitSchema>;

export const RecipientPolicySchema = z.object({
  /** Allowlist mode: only allow payments to these recipients */
  allowlist: z.array(z.string()).optional(),
  /** Blocklist mode: block payments to these recipients */
  blocklist: z.array(z.string()).optional(),
  /** Allow payments to unknown recipients (not in allowlist) */
  allowUnknown: z.boolean().default(true),
});

export type RecipientPolicy = z.infer<typeof RecipientPolicySchema>;

export const RateLimitSchema = z.object({
  /** Maximum number of transactions per window */
  maxTransactions: z.number().positive(),
  /** Time window in seconds */
  windowSeconds: z.number().positive(),
  /** Cooldown between transactions in seconds */
  cooldownSeconds: z.number().nonnegative().default(0),
  /** Current transaction count in window (runtime state) */
  currentCount: z.number().optional(),
  /** Window start timestamp (runtime state) */
  windowStart: z.number().optional(),
  /** Last transaction timestamp (runtime state) */
  lastTransaction: z.number().optional(),
});

export type RateLimit = z.infer<typeof RateLimitSchema>;

export const ChannelPolicySchema = z.object({
  /** Allow opening new channels */
  allowOpen: z.boolean().default(true),
  /** Allow closing channels */
  allowClose: z.boolean().default(true),
  /** Allow force close */
  allowForceClose: z.boolean().default(false),
  /** Maximum funding amount for new channels */
  maxFundingAmount: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  /** Minimum funding amount for new channels */
  minFundingAmount: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  /** Maximum number of channels */
  maxChannels: z.number().positive().optional(),
});

export type ChannelPolicy = z.infer<typeof ChannelPolicySchema>;

export const SecurityPolicySchema = z.object({
  /** Policy name for identification */
  name: z.string(),
  /** Policy version */
  version: z.string().default('1.0.0'),
  /** Whether this policy is active */
  enabled: z.boolean().default(true),
  /** Spending limits configuration */
  spending: SpendingLimitSchema.optional(),
  /** Recipient restrictions */
  recipients: RecipientPolicySchema.optional(),
  /** Rate limiting configuration */
  rateLimit: RateLimitSchema.optional(),
  /** Channel operation policy */
  channels: ChannelPolicySchema.optional(),
  /** Require confirmation for amounts above this threshold */
  confirmationThreshold: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  /** Log all transactions to audit log */
  auditLogging: z.boolean().default(true),
  /** Custom metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SecurityPolicy = z.infer<typeof SecurityPolicySchema>;

// =============================================================================
// Policy Violation Types
// =============================================================================

export type ViolationType =
  | 'SPENDING_LIMIT_PER_TX'
  | 'SPENDING_LIMIT_PER_WINDOW'
  | 'RATE_LIMIT_EXCEEDED'
  | 'RATE_LIMIT_COOLDOWN'
  | 'RECIPIENT_NOT_ALLOWED'
  | 'RECIPIENT_BLOCKED'
  | 'CHANNEL_OPEN_NOT_ALLOWED'
  | 'CHANNEL_CLOSE_NOT_ALLOWED'
  | 'CHANNEL_FORCE_CLOSE_NOT_ALLOWED'
  | 'CHANNEL_FUNDING_EXCEEDS_MAX'
  | 'CHANNEL_FUNDING_BELOW_MIN'
  | 'MAX_CHANNELS_REACHED'
  | 'REQUIRES_CONFIRMATION';

export interface PolicyViolation {
  type: ViolationType;
  message: string;
  details: {
    requested?: string;
    limit?: string;
    recipient?: string;
    remaining?: string;
    cooldownRemaining?: number;
  };
}

export interface PolicyCheckResult {
  allowed: boolean;
  violations: PolicyViolation[];
  requiresConfirmation: boolean;
}

// =============================================================================
// Audit Log Types
// =============================================================================

export type AuditAction =
  | 'PAYMENT_SENT'
  | 'PAYMENT_RECEIVED'
  | 'INVOICE_CREATED'
  | 'INVOICE_VALIDATED'
  | 'CHANNEL_OPENED'
  | 'CHANNEL_CLOSED'
  | 'POLICY_VIOLATION'
  | 'POLICY_UPDATED'
  | 'NODE_STARTED'
  | 'NODE_STOPPED';

export interface AuditLogEntry {
  timestamp: number;
  action: AuditAction;
  success: boolean;
  details: Record<string, unknown>;
  policyViolations?: PolicyViolation[];
  sessionId?: string;
  agentId?: string;
}

// =============================================================================
// Key Management Types
// =============================================================================

export interface KeyConfig {
  /** Base directory for key storage */
  baseDir: string;
  /** Password for key encryption (should come from secure source) */
  encryptionPassword?: string;
  /** Whether to generate keys if they don't exist */
  autoGenerate: boolean;
}

export interface KeyInfo {
  /** Public key (hex) */
  publicKey: HexString;
  /** Whether the key is encrypted */
  encrypted: boolean;
  /** Key file path */
  path: string;
  /** Key creation timestamp */
  createdAt?: number;
}

// =============================================================================
// Session Types (for multi-agent scenarios)
// =============================================================================

export interface AgentSession {
  /** Unique session ID */
  sessionId: string;
  /** Agent identifier */
  agentId: string;
  /** Session start time */
  startedAt: number;
  /** Session expiry time */
  expiresAt?: number;
  /** Session-specific policy overrides */
  policyOverrides?: Partial<SecurityPolicy>;
  /** Session metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Default Policy
// =============================================================================

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  name: 'default',
  version: '1.0.0',
  enabled: true,
  spending: {
    // 100 CKB per transaction
    maxPerTransaction: '0x2540be400',
    // 1000 CKB per hour
    maxPerWindow: '0x174876e800',
    windowSeconds: 3600,
  },
  rateLimit: {
    maxTransactions: 100,
    windowSeconds: 3600,
    cooldownSeconds: 1,
  },
  recipients: {
    allowUnknown: true,
  },
  channels: {
    allowOpen: true,
    allowClose: true,
    allowForceClose: false,
    maxChannels: 10,
  },
  auditLogging: true,
};
