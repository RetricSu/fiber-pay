import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  GrantStatus,
  Permission,
  PermissionGrant,
  PermissionGrantRow,
  PermissionUsageDaily,
  PermissionUsageDailyRow,
  PermissionUsageHourly,
  PermissionUsageHourlyRow,
} from './types.js';

/**
 * Storage layer for permission grants system.
 * Provides CRUD operations for grants, usage tracking, and whitelist management.
 * Uses better-sqlite3 for synchronous, type-safe database operations.
 */
export class PermissionStorage {
  private readonly db: Database.Database;

  /**
   * Creates a new PermissionStorage instance
   * @param dbPath - Path to the SQLite database file
   */
  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Grant CRUD Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Creates a new permission grant
   * @param grant - Grant data (id and created_at will be generated)
   * @returns The created grant with generated id and created_at
   */
  createGrant(grant: Omit<PermissionGrant, 'id' | 'created_at'>): PermissionGrant {
    const id = randomUUID();
    const created_at = new Date();

    const fullGrant: PermissionGrant = {
      ...grant,
      id,
      created_at,
    };

    const stmt = this.db.prepare(`
      INSERT INTO permission_grants (
        id, app_id, app_name, node_id, token_ciphertext, created_at,
        expires_at, revoked_at, revocation_id, scopes, daily_payment_limit,
        per_payment_limit, daily_count_limit, hourly_count_limit, min_interval_seconds,
        channel_opening_allowed, channel_funding_limit, can_close_channels,
        can_force_close, time_window_start, time_window_end, time_window_days,
        total_payments_made, total_amount_paid, last_used_at, status
      ) VALUES (
        @id, @app_id, @app_name, @node_id, @token_ciphertext, @created_at,
        @expires_at, @revoked_at, @revocation_id, @scopes, @daily_payment_limit,
        @per_payment_limit, @daily_count_limit, @hourly_count_limit, @min_interval_seconds,
        @channel_opening_allowed, @channel_funding_limit, @can_close_channels,
        @can_force_close, @time_window_start, @time_window_end, @time_window_days,
        @total_payments_made, @total_amount_paid, @last_used_at, @status
      )
    `);

    stmt.run({
      id: fullGrant.id,
      app_id: fullGrant.app_id,
      app_name: fullGrant.app_name ?? null,
      node_id: fullGrant.node_id,
      token_ciphertext: Buffer.from(fullGrant.token_ciphertext),
      created_at: fullGrant.created_at.getTime(),
      expires_at: fullGrant.expires_at?.getTime() ?? null,
      revoked_at: fullGrant.revoked_at?.getTime() ?? null,
      revocation_id: fullGrant.revocation_id ?? null,
      scopes: JSON.stringify(fullGrant.scopes),
      daily_payment_limit:
        fullGrant.daily_payment_limit !== undefined
          ? fullGrant.daily_payment_limit.toString()
          : null,
      per_payment_limit:
        fullGrant.per_payment_limit !== undefined ? fullGrant.per_payment_limit.toString() : null,
      daily_count_limit: fullGrant.daily_count_limit ?? null,
      hourly_count_limit: fullGrant.hourly_count_limit ?? null,
      min_interval_seconds: fullGrant.min_interval_seconds ?? null,
      channel_opening_allowed: fullGrant.channel_opening_allowed ? 1 : 0,
      channel_funding_limit:
        fullGrant.channel_funding_limit !== undefined
          ? fullGrant.channel_funding_limit.toString()
          : null,
      can_close_channels: fullGrant.can_close_channels ? 1 : 0,
      can_force_close: fullGrant.can_force_close ? 1 : 0,
      time_window_start: fullGrant.time_window_start ?? null,
      time_window_end: fullGrant.time_window_end ?? null,
      time_window_days: fullGrant.time_window_days
        ? JSON.stringify(fullGrant.time_window_days)
        : null,
      total_payments_made: fullGrant.total_payments_made ?? 0,
      total_amount_paid: (fullGrant.total_amount_paid ?? 0n).toString(),
      last_used_at: fullGrant.last_used_at?.getTime() ?? null,
      status: fullGrant.status,
    });

    return fullGrant;
  }

  /**
   * Retrieves a grant by its ID
   * @param id - Grant ID
   * @returns The grant or undefined if not found
   */
  getGrantById(id: string): PermissionGrant | undefined {
    const row = this.db.prepare('SELECT * FROM permission_grants WHERE id = ?').get(id) as
      | PermissionGrantRow
      | undefined;

    return row ? this.rowToGrant(row) : undefined;
  }

  /**
   * Retrieves a grant by app ID
   * @param appId - Application ID
   * @returns The grant or undefined if not found
   */
  getGrantByAppId(appId: string): PermissionGrant | undefined {
    const row = this.db
      .prepare('SELECT * FROM permission_grants WHERE app_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(appId) as PermissionGrantRow | undefined;

    return row ? this.rowToGrant(row) : undefined;
  }

  /**
   * Lists grants with optional filters
   * @param filters - Optional filters for status and appId
   * @returns Array of matching grants
   */
  listGrants(filters?: { status?: GrantStatus; appId?: string }): PermissionGrant[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters?.status) {
      conditions.push('status = @status');
      params.status = filters.status;
    }

    if (filters?.appId) {
      conditions.push('app_id = @appId');
      params.appId = filters.appId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `SELECT * FROM permission_grants ${where} ORDER BY created_at DESC`;

    const rows = this.db.prepare(query).all(params) as PermissionGrantRow[];
    return rows.map((r) => this.rowToGrant(r));
  }

  /**
   * Updates a grant with partial data
   * @param id - Grant ID
   * @param updates - Partial grant data to update
   * @returns The updated grant
   * @throws Error if grant not found
   */
  updateGrant(id: string, updates: Partial<PermissionGrant>): PermissionGrant {
    const existing = this.getGrantById(id);
    if (!existing) {
      throw new Error(`Grant not found: ${id}`);
    }

    const merged: PermissionGrant = { ...existing, ...updates };

    const stmt = this.db.prepare(`
      UPDATE permission_grants SET
        app_id = @app_id,
        app_name = @app_name,
        node_id = @node_id,
        token_ciphertext = @token_ciphertext,
        expires_at = @expires_at,
        revoked_at = @revoked_at,
        revocation_id = @revocation_id,
        scopes = @scopes,
        daily_payment_limit = @daily_payment_limit,
        per_payment_limit = @per_payment_limit,
        daily_count_limit = @daily_count_limit,
        hourly_count_limit = @hourly_count_limit,
        min_interval_seconds = @min_interval_seconds,
        channel_opening_allowed = @channel_opening_allowed,
        channel_funding_limit = @channel_funding_limit,
        can_close_channels = @can_close_channels,
        can_force_close = @can_force_close,
        time_window_start = @time_window_start,
        time_window_end = @time_window_end,
        time_window_days = @time_window_days,
        total_payments_made = @total_payments_made,
        total_amount_paid = @total_amount_paid,
        last_used_at = @last_used_at,
        status = @status
      WHERE id = @id
    `);

    stmt.run({
      id: merged.id,
      app_id: merged.app_id,
      app_name: merged.app_name ?? null,
      node_id: merged.node_id,
      token_ciphertext: Buffer.from(merged.token_ciphertext),
      expires_at: merged.expires_at?.getTime() ?? null,
      revoked_at: merged.revoked_at?.getTime() ?? null,
      revocation_id: merged.revocation_id ?? null,
      scopes: JSON.stringify(merged.scopes),
      daily_payment_limit:
        merged.daily_payment_limit !== undefined ? merged.daily_payment_limit.toString() : null,
      per_payment_limit:
        merged.per_payment_limit !== undefined ? merged.per_payment_limit.toString() : null,
      daily_count_limit: merged.daily_count_limit ?? null,
      hourly_count_limit: merged.hourly_count_limit ?? null,
      min_interval_seconds: merged.min_interval_seconds ?? null,
      channel_opening_allowed: merged.channel_opening_allowed ? 1 : 0,
      channel_funding_limit:
        merged.channel_funding_limit !== undefined ? merged.channel_funding_limit.toString() : null,
      can_close_channels: merged.can_close_channels ? 1 : 0,
      can_force_close: merged.can_force_close ? 1 : 0,
      time_window_start: merged.time_window_start ?? null,
      time_window_end: merged.time_window_end ?? null,
      time_window_days: merged.time_window_days ? JSON.stringify(merged.time_window_days) : null,
      total_payments_made: merged.total_payments_made ?? 0,
      total_amount_paid: (merged.total_amount_paid ?? 0n).toString(),
      last_used_at: merged.last_used_at?.getTime() ?? null,
      status: merged.status,
    });

    return merged;
  }

  /**
   * Revokes a grant by setting its status and recording revocation details
   * @param id - Grant ID
   * @param revocationId - Revocation identifier
   */
  revokeGrant(id: string, revocationId: string): void {
    const existing = this.getGrantById(id);
    if (!existing) {
      throw new Error(`Grant not found: ${id}`);
    }

    this.db
      .prepare(`
        UPDATE permission_grants
        SET status = 'revoked', revoked_at = @revoked_at, revocation_id = @revocation_id
        WHERE id = @id
      `)
      .run({
        id,
        revoked_at: Date.now(),
        revocation_id: revocationId,
      });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Usage Tracking
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Records a payment usage for a grant
   * Updates daily and hourly usage tables, as well as grant totals
   * @param grantId - Grant ID
   * @param amount - Payment amount in shannons
   */
  recordPaymentUsage(grantId: string, amount: bigint): void {
    const now = new Date();
    const dateStr = this.formatDate(now);
    const hourStr = this.formatHour(now);

    // Run in transaction for consistency
    this.db.transaction(() => {
      // Update or insert daily usage
      this.db
        .prepare(`
          INSERT INTO permission_usage_daily (grant_id, date, amount_paid, payments_count)
          VALUES (@grant_id, @date, @amount, 1)
          ON CONFLICT(grant_id, date) DO UPDATE SET
            amount_paid = amount_paid + @amount,
            payments_count = payments_count + 1
        `)
        .run({
          grant_id: grantId,
          date: dateStr,
          amount: amount.toString(),
        });

      // Update or insert hourly usage
      this.db
        .prepare(`
          INSERT INTO permission_usage_hourly (grant_id, hour, payments_count)
          VALUES (@grant_id, @hour, 1)
          ON CONFLICT(grant_id, hour) DO UPDATE SET
            payments_count = payments_count + 1
        `)
        .run({
          grant_id: grantId,
          hour: hourStr,
        });

      // Update grant totals
      this.db
        .prepare(`
          UPDATE permission_grants
          SET total_payments_made = total_payments_made + 1,
              total_amount_paid = total_amount_paid + @amount,
              last_used_at = @last_used_at
          WHERE id = @id
        `)
        .run({
          id: grantId,
          amount: amount.toString(),
          last_used_at: now.getTime(),
        });
    })();
  }

  /**
   * Gets daily usage for a grant on a specific date
   * @param grantId - Grant ID
   * @param date - Date in YYYY-MM-DD format
   * @returns Daily usage record (returns zeros if no usage found)
   */
  getDailyUsage(grantId: string, date: string): PermissionUsageDaily {
    const row = this.db
      .prepare('SELECT * FROM permission_usage_daily WHERE grant_id = ? AND date = ?')
      .get(grantId, date) as PermissionUsageDailyRow | undefined;

    if (row) {
      return {
        grant_id: row.grant_id,
        date: row.date,
        amount_paid: BigInt(row.amount_paid),
        payments_count: row.payments_count,
      };
    }

    // Return default if no usage found
    return {
      grant_id: grantId,
      date,
      amount_paid: 0n,
      payments_count: 0,
    };
  }

  /**
   * Gets hourly usage for a grant in a specific hour
   * @param grantId - Grant ID
   * @param hour - Hour in YYYY-MM-DD-HH format
   * @returns Hourly usage record (returns zero count if no usage found)
   */
  getHourlyUsage(grantId: string, hour: string): PermissionUsageHourly {
    const row = this.db
      .prepare('SELECT * FROM permission_usage_hourly WHERE grant_id = ? AND hour = ?')
      .get(grantId, hour) as PermissionUsageHourlyRow | undefined;

    if (row) {
      return {
        grant_id: row.grant_id,
        hour: row.hour,
        payments_count: row.payments_count,
      };
    }

    // Return default if no usage found
    return {
      grant_id: grantId,
      hour,
      payments_count: 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Whitelist Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Adds recipients to the whitelist for a grant
   * @param grantId - Grant ID
   * @param recipients - Array of recipient addresses
   */
  addRecipientWhitelist(grantId: string, recipients: string[]): void {
    if (recipients.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO permission_recipient_whitelist (grant_id, recipient)
      VALUES (@grant_id, @recipient)
    `);

    this.db.transaction(() => {
      for (const recipient of recipients) {
        stmt.run({ grant_id: grantId, recipient });
      }
    })();
  }

  /**
   * Gets all whitelisted recipients for a grant
   * @param grantId - Grant ID
   * @returns Array of recipient addresses
   */
  getRecipientWhitelist(grantId: string): string[] {
    const rows = this.db
      .prepare('SELECT recipient FROM permission_recipient_whitelist WHERE grant_id = ?')
      .all(grantId) as Array<{ recipient: string }>;

    return rows.map((r) => r.recipient);
  }

  /**
   * Adds channel IDs to the allowed channels list for a grant
   * @param grantId - Grant ID
   * @param channelIds - Array of channel IDs
   */
  addAllowedChannels(grantId: string, channelIds: string[]): void {
    if (channelIds.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO permission_allowed_channels (grant_id, channel_id)
      VALUES (@grant_id, @channel_id)
    `);

    this.db.transaction(() => {
      for (const channelId of channelIds) {
        stmt.run({ grant_id: grantId, channel_id: channelId });
      }
    })();
  }

  /**
   * Gets all allowed channel IDs for a grant
   * @param grantId - Grant ID
   * @returns Array of channel IDs
   */
  getAllowedChannels(grantId: string): string[] {
    const rows = this.db
      .prepare('SELECT channel_id FROM permission_allowed_channels WHERE grant_id = ?')
      .all(grantId) as Array<{ channel_id: string }>;

    return rows.map((r) => r.channel_id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Closes the database connection
   */
  close(): void {
    this.db.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Converts a database row to PermissionGrant type
   */
  private rowToGrant(row: PermissionGrantRow): PermissionGrant {
    return {
      id: row.id,
      app_id: row.app_id,
      app_name: row.app_name ?? undefined,
      node_id: row.node_id,
      token_ciphertext: new Uint8Array(row.token_ciphertext),
      created_at: new Date(row.created_at),
      expires_at: row.expires_at !== null ? new Date(row.expires_at) : undefined,
      revoked_at: row.revoked_at !== null ? new Date(row.revoked_at) : undefined,
      revocation_id: row.revocation_id ?? undefined,
      scopes: JSON.parse(row.scopes) as Permission[],
      daily_payment_limit:
        row.daily_payment_limit !== null ? BigInt(row.daily_payment_limit) : undefined,
      per_payment_limit: row.per_payment_limit !== null ? BigInt(row.per_payment_limit) : undefined,
      daily_count_limit: row.daily_count_limit ?? undefined,
      hourly_count_limit: row.hourly_count_limit ?? undefined,
      min_interval_seconds: row.min_interval_seconds ?? undefined,
      channel_opening_allowed: Boolean(row.channel_opening_allowed),
      channel_funding_limit:
        row.channel_funding_limit !== null ? BigInt(row.channel_funding_limit) : undefined,
      can_close_channels: Boolean(row.can_close_channels),
      can_force_close: Boolean(row.can_force_close),
      time_window_start: row.time_window_start ?? undefined,
      time_window_end: row.time_window_end ?? undefined,
      time_window_days: row.time_window_days
        ? (JSON.parse(row.time_window_days) as string[])
        : undefined,
      total_payments_made: row.total_payments_made,
      total_amount_paid: BigInt(row.total_amount_paid),
      last_used_at: row.last_used_at !== null ? new Date(row.last_used_at) : undefined,
      status: row.status as GrantStatus,
    };
  }

  /**
   * Formats a date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Formats a date hour as YYYY-MM-DD-HH
   */
  private formatHour(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}`;
  }
}
