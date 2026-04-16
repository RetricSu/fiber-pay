export interface ExecOptions {
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
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
   * Execute a command inside the box.
   * @param command - The command to run
   * @param args - Arguments for the command
   * @param options - Optional execution settings (env, cwd, timeout)
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
        !('stdout' in data) ||
        !('stderr' in data) ||
        !('exit_code' in data) ||
        typeof (data as Record<string, unknown>).stdout !== 'string' ||
        typeof (data as Record<string, unknown>).stderr !== 'string' ||
        typeof (data as Record<string, unknown>).exit_code !== 'number'
      ) {
        throw new BoxliteError(
          'EXEC_FAILED',
          'BoxLite exec returned an unexpected response format.',
        );
      }

      return {
        stdout: (data as Record<string, unknown>).stdout as string,
        stderr: (data as Record<string, unknown>).stderr as string,
        exit_code: (data as Record<string, unknown>).exit_code as number,
      };
    } catch (error) {
      if (error instanceof BoxliteError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BoxliteError('BOXLITE_UNREACHABLE', `BoxLite server is unreachable: ${message}`);
    }
  }
}
