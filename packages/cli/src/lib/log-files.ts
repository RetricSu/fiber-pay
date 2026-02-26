import { closeSync, createReadStream, existsSync, openSync, readSync, statSync } from 'node:fs';
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

export function resolvePersistedLogPaths(
  dataDir: string,
  meta?: RuntimeMeta | null,
): PersistedLogPaths {
  return {
    runtimeAlerts: meta?.alertLogFilePath ?? join(dataDir, 'logs', 'runtime.alerts.jsonl'),
    fnnStdout: meta?.fnnStdoutLogPath ?? join(dataDir, 'logs', 'fnn.stdout.log'),
    fnnStderr: meta?.fnnStderrLogPath ?? join(dataDir, 'logs', 'fnn.stderr.log'),
  };
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
