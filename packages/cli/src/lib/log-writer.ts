import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class LogWriter {
  private stream: WriteStream | null = null;
  private pendingWrites = 0;
  private lastErrorTime = 0;
  private readonly errorRateLimitMs = 1000;
  private isClosing = false;
  private waitingForDrain = false;
  private currentDate: string | null = null;

  constructor(
    private readonly baseDir: string,
    private readonly filename: string,
  ) {}

  async append(text: string): Promise<void> {
    if (this.isClosing) {
      throw new Error('Cannot append to closing LogWriter');
    }

    await this.ensureStream();

    if (!this.stream) {
      throw new Error('Failed to create write stream');
    }

    return new Promise((resolve, reject) => {
      const stream = this.stream!;

      if (this.waitingForDrain) {
        const onDrain = () => {
          this.waitingForDrain = false;
          stream.off('drain', onDrain);
          stream.off('error', onError);
          this.performWrite(text, resolve, reject);
        };

        const onError = (err: Error) => {
          this.waitingForDrain = false;
          stream.off('drain', onDrain);
          stream.off('error', onError);
          this.handleError(err);
          reject(err);
        };

        stream.once('drain', onDrain);
        stream.once('error', onError);
        return;
      }

      this.performWrite(text, resolve, reject);
    });
  }

  async flush(): Promise<void> {
    if (this.isClosing || !this.stream) {
      return;
    }

    this.isClosing = true;

    while (this.pendingWrites > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return new Promise((resolve, reject) => {
      if (!this.stream) {
        resolve();
        return;
      }

      const stream = this.stream;

      stream.once('finish', () => {
        this.stream = null;
        resolve();
      });

      stream.once('error', (err: Error) => {
        this.handleError(err);
        this.stream = null;
        reject(err);
      });

      stream.end();
    });
  }

  private async ensureStream(): Promise<void> {
    const today = this.todayDateString();

    if (this.stream && this.currentDate !== today && !this.isClosing) {
      await this.flush();
      this.stream = null;
    }

    if (this.stream && !this.isClosing) {
      return;
    }

    this.currentDate = today;
    const logPath = this.resolveLogPath();
    await this.ensureDirectory(logPath);

    this.stream = createWriteStream(logPath, {
      flags: 'a',
      highWaterMark: 16 * 1024,
    });

    this.stream.on('error', (err: Error) => {
      this.handleError(err);
      this.stream = null;
      this.isClosing = true;
    });

    this.isClosing = false;
  }

  private performWrite(text: string, resolve: () => void, reject: (err: Error) => void): void {
    if (!this.stream) {
      reject(new Error('Stream is not available'));
      return;
    }

    this.pendingWrites += 1;

    const canContinue = this.stream.write(text, (err: Error | null | undefined) => {
      this.pendingWrites -= 1;
      if (err) {
        this.handleError(err);
        reject(err);
      } else {
        resolve();
      }
    });

    if (!canContinue) {
      this.waitingForDrain = true;
    }
  }

  private async ensureDirectory(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
  }

  private resolveLogPath(): string {
    const dateStr = this.todayDateString();
    return join(this.baseDir, 'logs', dateStr, this.filename);
  }

  private todayDateString(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private handleError(error: Error): void {
    const now = Date.now();
    if (now - this.lastErrorTime >= this.errorRateLimitMs) {
      this.lastErrorTime = now;
      console.error(`[LogWriter] ${error.message}`);
    }
  }
}
