import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { readAppendedLines, readLastLines } from '../src/lib/log-files.js';

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
