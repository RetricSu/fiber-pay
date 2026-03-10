import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogWriter } from '../src/lib/log-writer.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fiber-pay-cli-logwriter-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function getTodayDateString(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

describe('LogWriter', () => {
  it('append() writes content to file', async () => {
    const baseDir = makeTempDir();
    const writer = new LogWriter(baseDir, 'test.log');

    await writer.append('hello world\n');
    await writer.flush();

    const logPath = join(baseDir, 'logs', getTodayDateString(), 'test.log');
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, 'utf8');
    expect(content).toBe('hello world\n');
  });

  it('multiple appends maintain order', async () => {
    const baseDir = makeTempDir();
    const writer = new LogWriter(baseDir, 'test.log');

    await writer.append('first line\n');
    await writer.append('second line\n');
    await writer.append('third line\n');
    await writer.flush();

    const logPath = join(baseDir, 'logs', getTodayDateString(), 'test.log');
    const content = readFileSync(logPath, 'utf8');
    expect(content).toBe('first line\nsecond line\nthird line\n');
  });

  it('flush() waits for pending writes to complete', async () => {
    const baseDir = makeTempDir();
    const writer = new LogWriter(baseDir, 'test.log');

    // Fire many concurrent writes
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(writer.append(`line ${i}\n`));
    }

    // Wait for all writes to settle (they may complete in any order)
    await Promise.all(promises);
    // Flush ensures stream is properly closed
    await writer.flush();

    const logPath = join(baseDir, 'logs', getTodayDateString(), 'test.log');
    const content = readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(100);

    // All lines should be present (order not guaranteed with concurrent writes)
    const sortedLines = [...lines].sort((a, b) => {
      const numA = parseInt(a.replace('line ', ''), 10);
      const numB = parseInt(b.replace('line ', ''), 10);
      return numA - numB;
    });
    for (let i = 0; i < 100; i++) {
      expect(sortedLines[i]).toBe(`line ${i}`);
    }
  });

  it('creates date directory structure automatically', async () => {
    const baseDir = makeTempDir();
    const writer = new LogWriter(baseDir, 'test.log');

    await writer.append('content\n');
    await writer.flush();

    const logsDir = join(baseDir, 'logs');
    expect(existsSync(logsDir)).toBe(true);

    const dateDir = join(logsDir, getTodayDateString());
    expect(existsSync(dateDir)).toBe(true);

    const entries = readdirSync(dateDir);
    expect(entries).toContain('test.log');
  });

  it('handles concurrent appends correctly', async () => {
    const baseDir = makeTempDir();
    const writer = new LogWriter(baseDir, 'test.log');

    const numWrites = 50;
    const writers = Array.from({ length: numWrites }, (_, i) => writer.append(`concurrent-${i}\n`));

    await Promise.all(writers);
    await writer.flush();

    const logPath = join(baseDir, 'logs', getTodayDateString(), 'test.log');
    const content = readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n');

    expect(lines).toHaveLength(numWrites);

    // Numeric sort to handle 'concurrent-2' vs 'concurrent-10' correctly
    const sortedLines = [...lines].sort((a, b) => {
      const numA = parseInt(a.replace('concurrent-', ''), 10);
      const numB = parseInt(b.replace('concurrent-', ''), 10);
      return numA - numB;
    });
    for (let i = 0; i < numWrites; i++) {
      expect(sortedLines[i]).toBe(`concurrent-${i}`);
    }
  });

  it('throws error when appending to closing writer', async () => {
    const baseDir = makeTempDir();
    const writer = new LogWriter(baseDir, 'test.log');

    await writer.append('before close\n');
    const flushPromise = writer.flush();

    await expect(writer.append('after close\n')).rejects.toThrow(
      'Cannot append to closing LogWriter',
    );

    await flushPromise;
  });

  it('handles empty string append', async () => {
    const baseDir = makeTempDir();
    const writer = new LogWriter(baseDir, 'test.log');

    await writer.append('');
    await writer.flush();

    const logPath = join(baseDir, 'logs', getTodayDateString(), 'test.log');
    const content = readFileSync(logPath, 'utf8');
    expect(content).toBe('');
  });

  it('supports different filenames in same directory', async () => {
    const baseDir = makeTempDir();
    const writer1 = new LogWriter(baseDir, 'file1.log');
    const writer2 = new LogWriter(baseDir, 'file2.log');

    await writer1.append('content for file1\n');
    await writer2.append('content for file2\n');
    await writer1.flush();
    await writer2.flush();

    const dateDir = join(baseDir, 'logs', getTodayDateString());
    const content1 = readFileSync(join(dateDir, 'file1.log'), 'utf8');
    const content2 = readFileSync(join(dateDir, 'file2.log'), 'utf8');

    expect(content1).toBe('content for file1\n');
    expect(content2).toBe('content for file2\n');
  });

  it('rotates to new date directory when date changes', async () => {
    const baseDir = makeTempDir();
    const writer = new LogWriter(baseDir, 'test.log');

    const date1 = '2024-01-15';
    const date2 = '2024-01-16';

    const spy = vi.spyOn(writer as unknown as { todayDateString(): string }, 'todayDateString');

    spy.mockReturnValue(date1);
    await writer.append('before midnight\n');

    spy.mockReturnValue(date2);
    await writer.append('after midnight\n');

    await writer.flush();

    const date1Dir = join(baseDir, 'logs', date1);
    const date2Dir = join(baseDir, 'logs', date2);

    expect(existsSync(date1Dir)).toBe(true);
    expect(existsSync(date2Dir)).toBe(true);

    const content1 = readFileSync(join(date1Dir, 'test.log'), 'utf8');
    const content2 = readFileSync(join(date2Dir, 'test.log'), 'utf8');

    expect(content1).toBe('before midnight\n');
    expect(content2).toBe('after midnight\n');

    spy.mockRestore();
  });
});
