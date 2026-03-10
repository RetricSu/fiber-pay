import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Alert, AlertBackend } from '../types.js';

export class JsonlFileAlertBackend implements AlertBackend {
  private readonly path: string;
  private initialized = false;

  constructor(path: string) {
    this.path = path;
  }

  async send(alert: Alert): Promise<void> {
    if (!this.initialized) {
      await mkdir(dirname(this.path), { recursive: true });
      this.initialized = true;
    }
    await appendFile(this.path, `${JSON.stringify(alert)}\n`, 'utf-8');
  }
}

function todayDateString(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Alert backend that writes JSONL to a daily-rotated file under
 * `<baseLogsDir>/<YYYY-MM-DD>/<filename>`.
 */
export class DailyJsonlFileAlertBackend implements AlertBackend {
  private readonly baseLogsDir: string;
  private readonly filename: string;

  constructor(baseLogsDir: string, filename = 'runtime.alerts.jsonl') {
    this.baseLogsDir = baseLogsDir;
    this.filename = filename;
  }

  async send(alert: Alert): Promise<void> {
    const dateDir = join(this.baseLogsDir, todayDateString());
    await mkdir(dateDir, { recursive: true });
    await appendFile(join(dateDir, this.filename), `${JSON.stringify(alert)}\n`, 'utf-8');
  }
}
