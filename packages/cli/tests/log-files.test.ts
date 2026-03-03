import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendToTodayLog,
  listLogDates,
  readAppendedLines,
  readLastLines,
  resolveLogDirForDate,
  resolvePersistedLogPaths,
  todayDateString,
} from '../src/lib/log-files.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fiber-pay-cli-logs-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('log-files', () => {
  it('reads appended lines incrementally and preserves partial line remainder', async () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'runtime.alerts.jsonl');

    writeFileSync(filePath, 'line-1\nline-2\npart', 'utf8');

    const first = await readAppendedLines(filePath, 0, '');
    expect(first.lines).toEqual(['line-1', 'line-2']);
    expect(first.remainder).toBe('part');
    expect(first.nextOffset).toBeGreaterThan(0);

    appendFileSync(filePath, 'ial\nline-4\n', 'utf8');

    const second = await readAppendedLines(filePath, first.nextOffset, first.remainder);
    expect(second.lines).toEqual(['partial', 'line-4']);
    expect(second.remainder).toBe('');
    expect(second.nextOffset).toBeGreaterThan(first.nextOffset);
  });

  it('tails a large log file without reading unbounded lines', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'fnn.stdout.log');

    const totalLines = 120_000;
    const payload = Array.from({ length: totalLines }, (_, index) => `line-${index}`).join('\n') + '\n';
    writeFileSync(filePath, payload, 'utf8');

    const tailed = readLastLines(filePath, 80);
    expect(tailed).toHaveLength(80);
    expect(tailed[0]).toBe(`line-${totalLines - 80}`);
    expect(tailed[79]).toBe(`line-${totalLines - 1}`);
  });
});

describe('daily log rotation', () => {
  it('todayDateString returns a valid YYYY-MM-DD string', () => {
    const result = todayDateString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('resolveLogDirForDate creates date directory and returns correct path', () => {
    const dataDir = makeTempDir();
    const dir = resolveLogDirForDate(dataDir, '2026-01-15');
    expect(dir).toBe(join(dataDir, 'logs', '2026-01-15'));
    expect(existsSync(dir)).toBe(true);
  });

  it('resolveLogDirForDate defaults to today when no date provided', () => {
    const dataDir = makeTempDir();
    const dir = resolveLogDirForDate(dataDir);
    const today = todayDateString();
    expect(dir).toBe(join(dataDir, 'logs', today));
    expect(existsSync(dir)).toBe(true);
  });

  it('resolvePersistedLogPaths with explicit date returns date-based paths', () => {
    const dataDir = makeTempDir();
    const paths = resolvePersistedLogPaths(dataDir, null, '2026-02-20');
    expect(paths.runtimeAlerts).toBe(join(dataDir, 'logs', '2026-02-20', 'runtime.alerts.jsonl'));
    expect(paths.fnnStdout).toBe(join(dataDir, 'logs', '2026-02-20', 'fnn.stdout.log'));
    expect(paths.fnnStderr).toBe(join(dataDir, 'logs', '2026-02-20', 'fnn.stderr.log'));
  });

  it('resolvePersistedLogPaths with explicit date honors meta.logsBaseDir', () => {
    const dataDir = makeTempDir();
    const meta = {
      pid: 1,
      startedAt: '',
      fiberRpcUrl: '',
      proxyListen: '',
      logsBaseDir: '/custom/logs-base',
      daemon: false,
    };

    const paths = resolvePersistedLogPaths(dataDir, meta, '2026-02-21');
    expect(paths.runtimeAlerts).toBe('/custom/logs-base/2026-02-21/runtime.alerts.jsonl');
    expect(paths.fnnStdout).toBe('/custom/logs-base/2026-02-21/fnn.stdout.log');
    expect(paths.fnnStderr).toBe('/custom/logs-base/2026-02-21/fnn.stderr.log');
  });

  it('resolvePersistedLogPaths does not create date directory during read-only resolution', () => {
    const dataDir = makeTempDir();
    const dateDir = join(dataDir, 'logs', '2026-02-22');

    resolvePersistedLogPaths(dataDir, null, '2026-02-22');
    expect(existsSync(dateDir)).toBe(false);
  });

  it('resolvePersistedLogPaths rejects invalid date input', () => {
    const dataDir = makeTempDir();
    expect(() => resolvePersistedLogPaths(dataDir, null, '../../escape')).toThrow(
      /Expected format YYYY-MM-DD/,
    );
  });

  it('resolvePersistedLogPaths without date defaults to today directory', () => {
    const dataDir = makeTempDir();
    const paths = resolvePersistedLogPaths(dataDir);
    const today = todayDateString();
    expect(paths.fnnStdout).toBe(join(dataDir, 'logs', today, 'fnn.stdout.log'));
  });

  it('resolvePersistedLogPaths respects meta paths when no date given', () => {
    const dataDir = makeTempDir();
    const meta = {
      pid: 1,
      startedAt: '',
      fiberRpcUrl: '',
      proxyListen: '',
      alertLogFilePath: '/custom/runtime.alerts.jsonl',
      fnnStdoutLogPath: '/custom/fnn.stdout.log',
      fnnStderrLogPath: '/custom/fnn.stderr.log',
      daemon: false,
    };
    const paths = resolvePersistedLogPaths(dataDir, meta);
    expect(paths.runtimeAlerts).toBe('/custom/runtime.alerts.jsonl');
    expect(paths.fnnStdout).toBe('/custom/fnn.stdout.log');
    expect(paths.fnnStderr).toBe('/custom/fnn.stderr.log');
  });

  it('resolvePersistedLogPaths with date overrides meta paths', () => {
    const dataDir = makeTempDir();
    const meta = {
      pid: 1,
      startedAt: '',
      fiberRpcUrl: '',
      proxyListen: '',
      alertLogFilePath: '/custom/runtime.alerts.jsonl',
      daemon: false,
    };
    const paths = resolvePersistedLogPaths(dataDir, meta, '2026-03-01');
    expect(paths.runtimeAlerts).toBe(join(dataDir, 'logs', '2026-03-01', 'runtime.alerts.jsonl'));
  });

  it('resolvePersistedLogPaths with partial meta paths falls back to today date directory', () => {
    const dataDir = makeTempDir();
    const meta = {
      pid: 1,
      startedAt: '',
      fiberRpcUrl: '',
      proxyListen: '',
      alertLogFilePath: '/custom/runtime.alerts.jsonl',
      daemon: false,
    };

    const paths = resolvePersistedLogPaths(dataDir, meta);
    const today = todayDateString();
    expect(paths.runtimeAlerts).toBe('/custom/runtime.alerts.jsonl');
    expect(paths.fnnStdout).toBe(join(dataDir, 'logs', today, 'fnn.stdout.log'));
    expect(paths.fnnStderr).toBe(join(dataDir, 'logs', today, 'fnn.stderr.log'));
  });

  it('resolvePersistedLogPaths with partial meta paths honors logsBaseDir for fallback', () => {
    const dataDir = makeTempDir();
    const customLogsBase = join(dataDir, 'custom-logs');
    const meta = {
      pid: 1,
      startedAt: '',
      fiberRpcUrl: '',
      proxyListen: '',
      alertLogFilePath: '/custom/runtime.alerts.jsonl',
      logsBaseDir: customLogsBase,
      daemon: false,
    };

    const paths = resolvePersistedLogPaths(dataDir, meta);
    const today = todayDateString();
    expect(paths.runtimeAlerts).toBe('/custom/runtime.alerts.jsonl');
    expect(paths.fnnStdout).toBe(join(customLogsBase, today, 'fnn.stdout.log'));
    expect(paths.fnnStderr).toBe(join(customLogsBase, today, 'fnn.stderr.log'));
  });

  it('listLogDates returns sorted date directories newest-first', () => {
    const dataDir = makeTempDir();
    const logsDir = join(dataDir, 'logs');
    mkdirSync(join(logsDir, '2026-01-01'), { recursive: true });
    mkdirSync(join(logsDir, '2026-03-15'), { recursive: true });
    mkdirSync(join(logsDir, '2026-02-10'), { recursive: true });
    // A non-date directory should be excluded
    mkdirSync(join(logsDir, 'archive'), { recursive: true });
    // A file that looks like a date should be excluded
    writeFileSync(join(logsDir, '2026-04-01'), 'not a directory', 'utf8');

    const dates = listLogDates(dataDir);
    expect(dates).toEqual(['2026-03-15', '2026-02-10', '2026-01-01']);
  });

  it('listLogDates returns empty array when logs directory does not exist', () => {
    const dataDir = makeTempDir();
    const dates = listLogDates(dataDir);
    expect(dates).toEqual([]);
  });

  it('listLogDates supports custom logs base directory', () => {
    const dataDir = makeTempDir();
    const customLogsDir = join(dataDir, 'custom-logs');
    mkdirSync(join(customLogsDir, '2026-03-20'), { recursive: true });
    mkdirSync(join(customLogsDir, '2026-03-01'), { recursive: true });

    const dates = listLogDates(dataDir, customLogsDir);
    expect(dates).toEqual(['2026-03-20', '2026-03-01']);
  });

  it('appendToTodayLog writes to today date directory', () => {
    const dataDir = makeTempDir();
    appendToTodayLog(dataDir, 'fnn.stdout.log', 'hello\n');
    appendToTodayLog(dataDir, 'fnn.stdout.log', 'world\n');

    const today = todayDateString();
    const filePath = join(dataDir, 'logs', today, 'fnn.stdout.log');
    expect(existsSync(filePath)).toBe(true);

    const lines = readLastLines(filePath, 10);
    expect(lines).toEqual(['hello', 'world']);
  });
});
