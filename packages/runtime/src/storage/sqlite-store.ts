import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Job, JobEvent, JobEventType, JobFilter, JobState, JobType } from '../jobs/types.js';

// ─── Migrations ───────────────────────────────────────────────────────────────

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id                TEXT PRIMARY KEY,
        type              TEXT NOT NULL,
        state             TEXT NOT NULL,
        params            TEXT NOT NULL,
        result            TEXT,
        error             TEXT,
        retry_count       INTEGER NOT NULL DEFAULT 0,
        max_retries       INTEGER NOT NULL DEFAULT 3,
        next_retry_at     INTEGER,
        idempotency_key   TEXT NOT NULL UNIQUE,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        completed_at      INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_state         ON jobs(state);
      CREATE INDEX IF NOT EXISTS idx_jobs_type          ON jobs(type);
      CREATE INDEX IF NOT EXISTS idx_jobs_next_retry_at ON jobs(next_retry_at);

      CREATE TABLE IF NOT EXISTS job_events (
        id          TEXT PRIMARY KEY,
        job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        event_type  TEXT NOT NULL,
        from_state  TEXT,
        to_state    TEXT,
        data        TEXT,
        created_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id);
    `,
  },
];

// ─── SqliteJobStore ───────────────────────────────────────────────────────────

export class SqliteJobStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.runMigrations();
  }

  // ─── Migrations ─────────────────────────────────────────────────────────────

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    const applied = new Set<number>(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
        (r) => r.version,
      ),
    );

    for (const migration of MIGRATIONS) {
      if (!applied.has(migration.version)) {
        this.db.transaction(() => {
          this.db.exec(migration.sql);
          this.db
            .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
            .run(migration.version, Date.now());
        })();
      }
    }
  }

  // ─── Job CRUD ────────────────────────────────────────────────────────────────

  createJob<P, R>(job: Omit<Job<P, R>, 'id' | 'createdAt' | 'updatedAt'>): Job<P, R> {
    const now = Date.now();
    const full: Job<P, R> = {
      ...job,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO jobs
          (id, type, state, params, result, error, retry_count, max_retries,
           next_retry_at, idempotency_key, created_at, updated_at, completed_at)
         VALUES
          (@id, @type, @state, @params, @result, @error, @retry_count, @max_retries,
           @next_retry_at, @idempotency_key, @created_at, @updated_at, @completed_at)`,
      )
      .run({
        id: full.id,
        type: full.type,
        state: full.state,
        params: JSON.stringify(full.params),
        result: full.result !== undefined ? JSON.stringify(full.result) : null,
        error: full.error !== undefined ? JSON.stringify(full.error) : null,
        retry_count: full.retryCount,
        max_retries: full.maxRetries,
        next_retry_at: full.nextRetryAt ?? null,
        idempotency_key: full.idempotencyKey,
        created_at: full.createdAt,
        updated_at: full.updatedAt,
        completed_at: full.completedAt ?? null,
      });

    return full;
  }

  updateJob<P, R>(id: string, updates: Partial<Job<P, R>>): Job<P, R> {
    const existing = this.getJob<P, R>(id);
    if (!existing) throw new Error(`Job not found: ${id}`);

    const now = Date.now();
    const merged: Job<P, R> = { ...existing, ...updates, updatedAt: now };

    this.db
      .prepare(
        `UPDATE jobs SET
          state         = @state,
          params        = @params,
          result        = @result,
          error         = @error,
          retry_count   = @retry_count,
          next_retry_at = @next_retry_at,
          updated_at    = @updated_at,
          completed_at  = @completed_at
         WHERE id = @id`,
      )
      .run({
        id: merged.id,
        state: merged.state,
        params: JSON.stringify(merged.params),
        result: merged.result !== undefined ? JSON.stringify(merged.result) : null,
        error: merged.error !== undefined ? JSON.stringify(merged.error) : null,
        retry_count: merged.retryCount,
        next_retry_at: merged.nextRetryAt ?? null,
        updated_at: merged.updatedAt,
        completed_at: merged.completedAt ?? null,
      });

    return merged;
  }

  getJob<P = unknown, R = unknown>(id: string): Job<P, R> | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as DbRow | undefined;
    return row ? this.rowToJob<P, R>(row) : undefined;
  }

  getJobByIdempotencyKey<P = unknown, R = unknown>(key: string): Job<P, R> | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(key) as
      | DbRow
      | undefined;
    return row ? this.rowToJob<P, R>(row) : undefined;
  }

  listJobs<P = unknown, R = unknown>(filter: JobFilter = {}): Job<P, R>[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.type) {
      conditions.push('type = @type');
      params.type = filter.type;
    }
    if (filter.state) {
      const states = Array.isArray(filter.state) ? filter.state : [filter.state];
      const placeholders = states.map((_, i) => `@state_${i}`).join(', ');
      conditions.push(`state IN (${placeholders})`);
      for (const [i, s] of states.entries()) {
        params[`state_${i}`] = s;
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ? `LIMIT @limit` : '';
    const offset = filter.offset ? `OFFSET @offset` : '';

    if (filter.limit) params.limit = filter.limit;
    if (filter.offset) params.offset = filter.offset;

    const rows = this.db
      .prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC ${limit} ${offset}`)
      .all(params) as DbRow[];

    return rows.map((r) => this.rowToJob<P, R>(r));
  }

  deleteJob(id: string): void {
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  }

  /** Return jobs that are ready to be retried right now. */
  getRetryableJobs<P = unknown, R = unknown>(now = Date.now()): Job<P, R>[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE state = 'waiting_retry' AND next_retry_at <= @now
         ORDER BY next_retry_at ASC`,
      )
      .all({ now }) as DbRow[];
    return rows.map((r) => this.rowToJob<P, R>(r));
  }

  /** Return jobs in non-terminal states (for recovery after daemon restart). */
  getInProgressJobs<P = unknown, R = unknown>(): Job<P, R>[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE state IN (
           'queued',
           'executing',
           'inflight',
           'waiting_retry',
           'invoice_created',
           'invoice_active',
           'invoice_received',
           'channel_opening',
           'channel_accepting',
           'channel_abandoning',
           'channel_updating',
           'channel_awaiting_ready',
           'channel_closing'
         )
         ORDER BY created_at ASC`,
      )
      .all() as DbRow[];
    return rows.map((r) => this.rowToJob<P, R>(r));
  }

  // ─── Job Events ──────────────────────────────────────────────────────────────

  addJobEvent(
    jobId: string,
    eventType: JobEventType,
    fromState?: JobState,
    toState?: JobState,
    data?: Record<string, unknown>,
  ): JobEvent {
    const event: JobEvent = {
      id: randomUUID(),
      jobId,
      eventType,
      fromState,
      toState,
      data,
      createdAt: Date.now(),
    };

    this.db
      .prepare(
        `INSERT INTO job_events (id, job_id, event_type, from_state, to_state, data, created_at)
         VALUES (@id, @job_id, @event_type, @from_state, @to_state, @data, @created_at)`,
      )
      .run({
        id: event.id,
        job_id: event.jobId,
        event_type: event.eventType,
        from_state: event.fromState ?? null,
        to_state: event.toState ?? null,
        data: event.data !== undefined ? JSON.stringify(event.data) : null,
        created_at: event.createdAt,
      });

    return event;
  }

  listJobEvents(jobId: string): JobEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at ASC')
      .all(jobId) as DbEventRow[];

    return rows.map((r) => ({
      id: r.id,
      jobId: r.job_id,
      eventType: r.event_type as JobEventType,
      fromState: (r.from_state as JobState | undefined) ?? undefined,
      toState: (r.to_state as JobState | undefined) ?? undefined,
      data: r.data ? (JSON.parse(r.data) as Record<string, unknown>) : undefined,
      createdAt: r.created_at,
    }));
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private rowToJob<P, R>(row: DbRow): Job<P, R> {
    return {
      id: row.id,
      type: row.type as JobType,
      state: row.state as JobState,
      params: JSON.parse(row.params) as P,
      result: row.result ? (JSON.parse(row.result) as R) : undefined,
      error: row.error ? JSON.parse(row.error) : undefined,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      nextRetryAt: row.next_retry_at ?? undefined,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
    };
  }
}

// ─── Internal DB row type ─────────────────────────────────────────────────────

interface DbRow {
  id: string;
  type: string;
  state: string;
  params: string;
  result: string | null;
  error: string | null;
  retry_count: number;
  max_retries: number;
  next_retry_at: number | null;
  idempotency_key: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface DbEventRow {
  id: string;
  job_id: string;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  data: string | null;
  created_at: number;
}
