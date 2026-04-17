export interface ExecOptions {
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  signal?: AbortSignal;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export type BoxliteErrorCode = 'BOXLITE_UNREACHABLE' | 'BOX_NOT_FOUND' | 'EXEC_FAILED';

export class BoxliteError extends Error {
  readonly code: BoxliteErrorCode;

  constructor(code: BoxliteErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'BoxliteError';
  }
}

/**
 * Client for the BoxLite REST API.
 */
export class BoxliteClient {
  readonly baseUrl: string;
  readonly boxId: string;

  /**
   * @param baseUrl - Base URL of the BoxLite server (e.g. http://localhost:8100)
   * @param boxId - ID of the box to target
   */
  constructor(baseUrl: string, boxId: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.boxId = boxId;
  }

  private getBoxUrl(): string {
    return `${this.baseUrl}/v1/default/boxes/${encodeURIComponent(this.boxId)}`;
  }

  private parseExecutionOutput(text: string): {
    stdout: string;
    stderr: string;
    exit_code?: number;
  } {
    const lines = text.split(/\r?\n/);
    let currentEvent: string | null = null;
    let stdout = '';
    let stderr = '';
    let exit_code: number | undefined;

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const dataStr = line.slice(6);
        if (!currentEvent) continue;
        try {
          const payload = JSON.parse(dataStr) as unknown;
          if (
            currentEvent === 'stdout' &&
            payload &&
            typeof payload === 'object' &&
            'data' in payload
          ) {
            stdout += Buffer.from(
              String((payload as Record<string, unknown>).data),
              'base64',
            ).toString('utf-8');
          } else if (
            currentEvent === 'stderr' &&
            payload &&
            typeof payload === 'object' &&
            'data' in payload
          ) {
            stderr += Buffer.from(
              String((payload as Record<string, unknown>).data),
              'base64',
            ).toString('utf-8');
          } else if (
            currentEvent === 'exit' &&
            payload &&
            typeof payload === 'object' &&
            'exit_code' in payload
          ) {
            exit_code = Number((payload as Record<string, unknown>).exit_code);
          }
        } catch {
          // ignore malformed JSON
        }
      }
    }

    return { stdout, stderr, exit_code };
  }

  /**
   * Check whether the box exists on the BoxLite server.
   * @returns `true` if the box exists, `false` if it does not
   * @throws {BoxliteError} with code `BOXLITE_UNREACHABLE` if the server cannot be reached
   */
  async checkBoxExists(): Promise<boolean> {
    try {
      const response = await fetch(this.getBoxUrl(), {
        method: 'GET',
      });

      if (response.status === 404) {
        return false;
      }

      if (!response.ok) {
        throw new BoxliteError(
          'BOXLITE_UNREACHABLE',
          `BoxLite server returned unexpected status ${response.status} while checking box existence.`,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof BoxliteError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BoxliteError('BOXLITE_UNREACHABLE', `BoxLite server is unreachable: ${message}`);
    }
  }

  /**
   * Best-effort cancellation of a running BoxLite execution.
   * This does not throw on failure; it is meant for cleanup only.
   */
  async cancelExecution(executionId: string): Promise<void> {
    try {
      await fetch(`${this.getBoxUrl()}/executions/${encodeURIComponent(executionId)}/cancel`, {
        method: 'POST',
      });
    } catch {}
  }

  /**
   * Execute a command inside the box.
   * @param command - The command to run
   * @param args - Arguments for the command
   * @param options - Optional execution settings (env, cwd, timeout, signal)
   * @returns The execution result including stdout, stderr, and exit code
   * @throws {BoxliteError} with code `BOX_NOT_FOUND` if the box does not exist
   * @throws {BoxliteError} with code `EXEC_FAILED` if the command execution fails on the server
   * @throws {BoxliteError} with code `BOXLITE_UNREACHABLE` if the server cannot be reached
   */
  async exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult> {
    const body: Record<string, unknown> = {
      command,
      args,
    };

    if (options?.env !== undefined) {
      body.env = options.env;
    }
    if (options?.cwd !== undefined) {
      body.cwd = options.cwd;
    }
    if (options?.timeout !== undefined) {
      body.timeout = options.timeout;
    }

    let executionId: string;
    try {
      const response = await fetch(`${this.getBoxUrl()}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.status === 404) {
        throw new BoxliteError('BOX_NOT_FOUND', `BoxLite box "${this.boxId}" was not found.`);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => 'unknown error');
        throw new BoxliteError(
          'EXEC_FAILED',
          `BoxLite exec failed with status ${response.status}: ${text}`,
        );
      }

      const data = (await response.json()) as unknown;

      if (
        typeof data !== 'object' ||
        data === null ||
        !('execution_id' in data) ||
        typeof (data as Record<string, unknown>).execution_id !== 'string'
      ) {
        throw new BoxliteError(
          'EXEC_FAILED',
          'BoxLite exec returned an unexpected response format.',
        );
      }

      executionId = (data as Record<string, unknown>).execution_id as string;
    } catch (error) {
      if (error instanceof BoxliteError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BoxliteError('BOXLITE_UNREACHABLE', `BoxLite server is unreachable: ${message}`);
    }

    const timeoutMs = (options?.timeout ?? 60) * 1000;
    const startTime = Date.now();
    let accumulatedStdout = '';
    let accumulatedStderr = '';

    while (true) {
      if (options?.signal?.aborted) {
        await this.cancelExecution(executionId);
        throw new BoxliteError('EXEC_FAILED', 'BoxLite exec aborted');
      }

      try {
        const response = await fetch(
          `${this.getBoxUrl()}/executions/${encodeURIComponent(executionId)}/output`,
          { method: 'GET' },
        );

        if (response.status === 404) {
          throw new BoxliteError('BOX_NOT_FOUND', `BoxLite box "${this.boxId}" was not found.`);
        }

        if (!response.ok) {
          const text = await response.text().catch(() => 'unknown error');
          throw new BoxliteError(
            'EXEC_FAILED',
            `BoxLite exec failed with status ${response.status}: ${text}`,
          );
        }

        const text = await response.text();
        const parsed = this.parseExecutionOutput(text);
        accumulatedStdout += parsed.stdout;
        accumulatedStderr += parsed.stderr;

        if (parsed.exit_code !== undefined) {
          return {
            stdout: accumulatedStdout,
            stderr: accumulatedStderr,
            exit_code: parsed.exit_code,
          };
        }
      } catch (error) {
        if (error instanceof BoxliteError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new BoxliteError('BOXLITE_UNREACHABLE', `BoxLite server is unreachable: ${message}`);
      }

      if (Date.now() - startTime > timeoutMs) {
        await this.cancelExecution(executionId);
        throw new BoxliteError('EXEC_FAILED', 'BoxLite exec timed out');
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
