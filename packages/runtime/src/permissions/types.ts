import { z } from 'zod';

export type PermissionAction = 'read' | 'write';

export type PermissionResource = 'payments' | 'channels' | 'peers' | 'invoices' | 'node';

export type GrantStatus = 'pending' | 'active' | 'expired' | 'revoked';

export const PermissionActionSchema = z.enum(['read', 'write']);

export const PermissionResourceSchema = z.enum([
  'payments',
  'channels',
  'peers',
  'invoices',
  'node',
]);

export const GrantStatusSchema = z.enum(['pending', 'active', 'expired', 'revoked']);

export interface AppInfo {
  /** Unique app identifier (e.g., "com.example.app") */
  id: string;
  /** Human-readable app name */
  name: string;
  /** Optional icon URL */
  icon?: string;
  /** Optional callback URL for notifications */
  callback_url?: string;
}

export const AppInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  callback_url: z.string().optional(),
});

export interface PaymentPermission {
  resource: 'payments';
  action: 'write';
  /** Maximum amount allowed per payment (in shannons) */
  max_amount?: bigint;
  /** Daily cumulative payment limit (in shannons) */
  daily_limit?: bigint;
  /** Maximum number of payments per day */
  daily_count_limit?: number;
  /** Maximum number of payments per hour */
  hourly_count_limit?: number;
  /** Minimum seconds between payments */
  min_interval_seconds?: number;
  /** List of allowed recipient addresses */
  allowed_recipients?: string[];
}

export const PaymentPermissionSchema = z.object({
  resource: z.literal('payments'),
  action: z.literal('write'),
  max_amount: z.bigint().optional(),
  daily_limit: z.bigint().optional(),
  daily_count_limit: z.number().optional(),
  hourly_count_limit: z.number().optional(),
  min_interval_seconds: z.number().optional(),
  allowed_recipients: z.array(z.string()).optional(),
});

export interface ChannelPermission {
  resource: 'channels';
  action: 'write';
  /** Whether the app can create new channels */
  can_create_new?: boolean;
  /** Maximum funding amount for new channels (in shannons) */
  max_funding?: bigint;
  /** List of allowed channel IDs */
  allowed_channels?: string[];
  /** Whether the app can close channels */
  can_close?: boolean;
  /** Whether the app can force-close channels */
  can_force_close?: boolean;
}

export const ChannelPermissionSchema = z.object({
  resource: z.literal('channels'),
  action: z.literal('write'),
  can_create_new: z.boolean().optional(),
  max_funding: z.bigint().optional(),
  allowed_channels: z.array(z.string()).optional(),
  can_close: z.boolean().optional(),
  can_force_close: z.boolean().optional(),
});

export interface ReadOnlyPermission {
  resource: PermissionResource;
  action: 'read';
}

export const ReadOnlyPermissionSchema = z.object({
  resource: PermissionResourceSchema,
  action: z.literal('read'),
});

/** Discriminated union of all permission types */
export type Permission = PaymentPermission | ChannelPermission | ReadOnlyPermission;

export const PermissionSchema = z.union([
  PaymentPermissionSchema,
  ChannelPermissionSchema,
  ReadOnlyPermissionSchema,
]);

export interface PermissionRequest {
  /** Version of the permission request protocol */
  version: string;
  /** App information */
  app: AppInfo;
  /** Requested permissions */
  permissions: Permission[];
  /** Expiration duration in ISO 8601 format (e.g., "7d") */
  expires_in: string;
  /** Unique nonce for replay protection */
  nonce: string;
  /** Optional signature for verification */
  signature?: string;
}

export const PermissionRequestSchema = z.object({
  version: z.string(),
  app: AppInfoSchema,
  permissions: z.array(PermissionSchema),
  expires_in: z.string(),
  nonce: z.string(),
  signature: z.string().optional(),
});

export interface PermissionGrant {
  /** Unique grant ID (UUID) */
  id: string;
  /** App identifier */
  app_id: string;
  /** Optional app name for display */
  app_name?: string;
  /** Node identifier this grant is for */
  node_id: string;
  /** Encrypted token ciphertext */
  token_ciphertext: Uint8Array;
  /** When the grant was created */
  created_at: Date;
  /** When the grant expires (if applicable) */
  expires_at?: Date;
  /** When the grant was revoked (if applicable) */
  revoked_at?: Date;
  /** Revocation ID for lookup */
  revocation_id?: string;
  /** Serialized scopes/permissions */
  scopes: Permission[];
  /** Daily payment limit (in shannons) */
  daily_payment_limit?: bigint;
  /** Maximum amount per payment (in shannons) */
  per_payment_limit?: bigint;
  /** Maximum number of payments per day */
  daily_count_limit?: number;
  /** Maximum number of payments per hour */
  hourly_count_limit?: number;
  /** Minimum seconds between payments */
  min_interval_seconds?: number;
  /** Whether channel opening is allowed */
  channel_opening_allowed: boolean;
  /** Maximum channel funding amount (in shannons) */
  channel_funding_limit?: bigint;
  /** Whether the grantee can close channels */
  can_close_channels: boolean;
  /** Whether the grantee can force-close channels */
  can_force_close: boolean;
  /** Start of allowed time window (HH:MM) */
  time_window_start?: string;
  /** End of allowed time window (HH:MM) */
  time_window_end?: string;
  /** Days of week when grant is active */
  time_window_days?: string[];
  /** Total number of payments made with this grant */
  total_payments_made: number;
  /** Total amount paid with this grant (in shannons) */
  total_amount_paid: bigint;
  /** When the grant was last used */
  last_used_at?: Date;
  /** Current status of the grant */
  status: GrantStatus;
}

export interface PermissionGrantRow {
  id: string;
  app_id: string;
  app_name: string | null;
  node_id: string;
  token_ciphertext: Buffer;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  revocation_id: string | null;
  scopes: string;
  daily_payment_limit: string | null;
  per_payment_limit: string | null;
  daily_count_limit: number | null;
  hourly_count_limit: number | null;
  min_interval_seconds: number | null;
  channel_opening_allowed: number;
  channel_funding_limit: string | null;
  can_close_channels: number;
  can_force_close: number;
  time_window_start: string | null;
  time_window_end: string | null;
  time_window_days: string | null;
  total_payments_made: number;
  total_amount_paid: string;
  last_used_at: number | null;
  status: string;
}

export interface PermissionUsageDaily {
  /** Grant ID this usage is for */
  grant_id: string;
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Amount paid on this date (in shannons) */
  amount_paid: bigint;
  /** Number of payments on this date */
  payments_count: number;
}

export interface PermissionUsageDailyRow {
  grant_id: string;
  date: string;
  amount_paid: number;
  payments_count: number;
}

export interface PermissionUsageHourly {
  /** Grant ID this usage is for */
  grant_id: string;
  /** Hour in YYYY-MM-DD-HH format */
  hour: string;
  /** Number of payments in this hour */
  payments_count: number;
}

export interface PermissionUsageHourlyRow {
  grant_id: string;
  hour: string;
  payments_count: number;
}

export interface PermissionRecipientWhitelist {
  grant_id: string;
  recipient: string;
}

export interface PermissionAllowedChannel {
  grant_id: string;
  channel_id: string;
}

export type PaymentGrant = PermissionGrant & {
  scopes: (PaymentPermission | ReadOnlyPermission)[];
};

export type ChannelGrant = PermissionGrant & {
  scopes: (ChannelPermission | ReadOnlyPermission)[];
};

export type ReadOnlyGrant = PermissionGrant & {
  scopes: ReadOnlyPermission[];
};

const BigintSchema = z.union([
  z.bigint(),
  z.number().transform((n) => BigInt(n)),
  z.string().transform((s) => BigInt(s)),
]);

export const PermissionGrantSchema = z.object({
  id: z.string(),
  app_id: z.string(),
  app_name: z.string().optional(),
  node_id: z.string(),
  token_ciphertext: z.instanceof(Uint8Array),
  created_at: z.date(),
  expires_at: z.date().optional(),
  revoked_at: z.date().optional(),
  revocation_id: z.string().optional(),
  scopes: z.array(PermissionSchema),
  daily_payment_limit: BigintSchema.optional(),
  per_payment_limit: BigintSchema.optional(),
  daily_count_limit: z.number().optional(),
  hourly_count_limit: z.number().optional(),
  min_interval_seconds: z.number().optional(),
  channel_opening_allowed: z.boolean(),
  channel_funding_limit: BigintSchema.optional(),
  can_close_channels: z.boolean(),
  can_force_close: z.boolean(),
  time_window_start: z.string().optional(),
  time_window_end: z.string().optional(),
  time_window_days: z.array(z.string()).optional(),
  total_payments_made: z.number(),
  total_amount_paid: BigintSchema,
  last_used_at: z.date().optional(),
  status: GrantStatusSchema,
});

export const PermissionUsageDailySchema = z.object({
  grant_id: z.string(),
  date: z.string(),
  amount_paid: BigintSchema,
  payments_count: z.number(),
});

export const PermissionUsageHourlySchema = z.object({
  grant_id: z.string(),
  hour: z.string(),
  payments_count: z.number(),
});
