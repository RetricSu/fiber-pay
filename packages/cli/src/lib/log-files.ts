import {
  appendFileSync,
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import type { RuntimeMeta } from './runtime-meta.js';

export interface PersistedLogPaths {
  runtimeAlerts: string;
  fnnStdout: string;
  fnnStderr: string;
}

export type PersistedLogSource = 'runtime' | 'fnn-stdout' | 'fnn-stderr';
export type PersistedLogSourceOption = PersistedLogSource | 'all';

export interface PersistedLogTarget {
  source: PersistedLogSource;
  title: 'runtime.alerts' | 'fnn.stdout' | 'fnn.stderr';
  path: string;
}

const DATE_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the current UTC date as YYYY-MM-DD string.
 */
export function todayDateString(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface ResolveLogDirOptions {
  logsBaseDir?: string;
  ensureExists?: boolean;
}

export function validateLogDate(date: string): string {
  const value = date.trim();
  if (!DATE_DIR_PATTERN.test(value)) {
    throw new Error(`Invalid date '${value}'. Expected format YYYY-MM-DD.`);
  }
  if (value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`Invalid date '${value}'. Path separators or '..' are not allowed.`);
  }
  return value;
}

/**
 * Returns the path to a date-based log directory: `<data-dir>/logs/<YYYY-MM-DD>/`.
 * Creates the directory if it does not exist.
 */
export function resolveLogDirForDate(dataDir: string, date?: string): string {
  return resolveLogDirForDateWithOptions(dataDir, date, {});
}

export function resolveLogDirForDateWithOptions(
  dataDir: string,
  date: string | undefined,
  options: ResolveLogDirOptions,
): string {
  const dateStr = date ?? todayDateString();
  const logsBaseDir = options.logsBaseDir ?? join(dataDir, 'logs');
  if (date !== undefined) {
    validateLogDate(dateStr);
  }
  const dir = join(logsBaseDir, dateStr);
  const ensureExists = options.ensureExists ?? true;
  if (ensureExists) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Resolve persisted log paths for a given date.
 *
 * When `date` is provided, always returns paths under `<data-dir>/logs/<date>/`.
 * When `date` is omitted and `meta` provides explicit paths, those are used for
 * backward compatibility.  Otherwise defaults to today's date directory.
 */
export function resolvePersistedLogPaths(
  dataDir: string,
  meta?: RuntimeMeta | null,
  date?: string,
): PersistedLogPaths {
  const logsBaseDir = meta?.logsBaseDir ?? join(dataDir, 'logs');

  if (date) {
    const dir = resolveLogDirForDateWithOptions(dataDir, date, {
      logsBaseDir,
      ensureExists: false,
    });
    return {
      runtimeAlerts: join(dir, 'runtime.alerts.jsonl'),
      fnnStdout: join(dir, 'fnn.stdout.log'),
      fnnStderr: join(dir, 'fnn.stderr.log'),
    };
  }

  if (meta?.alertLogFilePath || meta?.fnnStdoutLogPath || meta?.fnnStderrLogPath) {
    return {
      runtimeAlerts: meta.alertLogFilePath ?? join(dataDir, 'logs', 'runtime.alerts.jsonl'),
      fnnStdout: meta.fnnStdoutLogPath ?? join(dataDir, 'logs', 'fnn.stdout.log'),
      fnnStderr: meta.fnnStderrLogPath ?? join(dataDir, 'logs', 'fnn.stderr.log'),
    };
  }

  const dir = resolveLogDirForDateWithOptions(dataDir, undefined, {
    logsBaseDir,
    ensureExists: false,
  });
  return {
    runtimeAlerts: join(dir, 'runtime.alerts.jsonl'),
    fnnStdout: join(dir, 'fnn.stdout.log'),
    fnnStderr: join(dir, 'fnn.stderr.log'),
  };
}

/**
 * List available log dates by scanning `<data-dir>/logs/` for YYYY-MM-DD directories.
 * Returns date strings sorted newest-first.
 */
export function listLogDates(dataDir: string, logsBaseDir?: string): string[] {
  const logsDir = logsBaseDir ?? join(dataDir, 'logs');
  if (!existsSync(logsDir)) {
    return [];
  }

  const entries = readdirSync(logsDir, { withFileTypes: true });
  const dates = entries
    .filter((entry) => entry.isDirectory() && DATE_DIR_PATTERN.test(entry.name))
    .map((entry) => entry.name);

  dates.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  return dates;
}

/**
 * Append text to a log file inside today's date directory.
 * Creates the date directory on first write each day.
 */
export function appendToTodayLog(dataDir: string, filename: string, text: string): void {
  const dir = resolveLogDirForDate(dataDir);
  appendFileSync(join(dir, filename), text, 'utf-8');
}

export function resolvePersistedLogTargets(
  paths: PersistedLogPaths,
  source: PersistedLogSourceOption,
): PersistedLogTarget[] {
  const all: PersistedLogTarget[] = [
    {
      source: 'runtime',
      title: 'runtime.alerts',
      path: paths.runtimeAlerts,
    },
    {
      source: 'fnn-stdout',
      title: 'fnn.stdout',
      path: paths.fnnStdout,
    },
    {
      source: 'fnn-stderr',
      title: 'fnn.stderr',
      path: paths.fnnStderr,
    },
  ];

  if (source === 'all') {
    return all;
  }

  return all.filter((target) => target.source === source);
}

export function readLastLines(filePath: string, maxLines: number): string[] {
  if (!existsSync(filePath)) {
    return [];
  }

  if (!Number.isFinite(maxLines) || maxLines <= 0) {
    return [];
  }

  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const size = statSync(filePath).size;
    if (size <= 0) {
      return [];
    }

    const chunkSize = 64 * 1024;
    let position = size;
    const chunks: string[] = [];
    let newlineCount = 0;

    while (position > 0 && newlineCount <= maxLines) {
      const start = Math.max(0, position - chunkSize);
      const bytesToRead = position - start;
      const buffer = Buffer.alloc(bytesToRead);
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, start);
      const chunk = buffer.toString('utf8', 0, bytesRead);
      chunks.unshift(chunk);

      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk.charCodeAt(index) === 10) {
          newlineCount += 1;
        }
      }

      position = start;
    }

    const content = chunks.join('');
    const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
    return lines.slice(-maxLines);
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore close errors
      }
    }
  }
}

export interface ReadAppendedLinesResult {
  lines: string[];
  nextOffset: number;
  remainder: string;
}

export async function readAppendedLines(
  filePath: string,
  offset: number,
  remainder = '',
): Promise<ReadAppendedLinesResult> {
  if (!existsSync(filePath)) {
    return { lines: [], nextOffset: 0, remainder: '' };
  }

  const size = statSync(filePath).size;
  const safeOffset = size < offset ? 0 : offset;
  if (safeOffset >= size) {
    return { lines: [], nextOffset: size, remainder };
  }

  const stream = createReadStream(filePath, {
    encoding: 'utf8',
    start: safeOffset,
    end: size - 1,
  });

  const lines: string[] = [];
  let pending = remainder;
  let bytesReadTotal = 0;

  for await (const chunk of stream) {
    const chunkText = String(chunk);
    bytesReadTotal += Buffer.byteLength(chunkText, 'utf8');

    const merged = `${pending}${chunkText}`;
    const parts = merged.split(/\r?\n/);
    pending = parts.pop() ?? '';

    for (const line of parts) {
      if (line.length > 0) {
        lines.push(line);
      }
    }
  }

  return {
    lines,
    nextOffset: safeOffset + bytesReadTotal,
    remainder: pending,
  };
}
