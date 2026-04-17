import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxliteClient, BoxliteError } from './boxlite-client.js';

function sseOutput(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}`;
}

describe('BoxliteClient', () => {
  let client: BoxliteClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    client = new BoxliteClient('http://localhost:8100', 'test-box');
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('checkBoxExists', () => {
    it('returns true when the box exists (200)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await client.checkBoxExists();

      expect(result).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8100/v1/default/boxes/test-box',
        { method: 'GET' },
      );
    });

    it('returns false when the box does not exist (404)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await client.checkBoxExists();

      expect(result).toBe(false);
    });

    it('throws BOXLITE_UNREACHABLE when BoxLite is unreachable', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      await expect(client.checkBoxExists()).rejects.toThrow(BoxliteError);
      await expect(client.checkBoxExists()).rejects.toMatchObject({
        code: 'BOXLITE_UNREACHABLE',
        message: expect.stringContaining('BoxLite'),
      });
    });
  });

  describe('exec', () => {
    it('returns stdout, stderr, and exit_code on success', async () => {
      const stdoutB64 = Buffer.from('hello', 'utf-8').toString('base64');
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ execution_id: 'exec-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            `${sseOutput('stdout', { data: stdoutB64 })}\n\n${sseOutput('exit', { exit_code: 0 })}\n\n`,
        });

      const result = await client.exec('echo', ['hello']);

      expect(result).toEqual({
        stdout: 'hello',
        stderr: '',
        exit_code: 0,
      });
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:8100/v1/default/boxes/test-box/exec',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'echo', args: ['hello'] }),
        },
      );
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:8100/v1/default/boxes/test-box/executions/exec-1/output',
        { method: 'GET' },
      );
    });

    it('returns non-zero exit code from async output endpoint', async () => {
      const stderrB64 = Buffer.from('command not found', 'utf-8').toString('base64');
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ execution_id: 'exec-2' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            `${sseOutput('stderr', { data: stderrB64 })}\n\n${sseOutput('exit', { exit_code: 127 })}\n\n`,
        });

      const result = await client.exec('missing-cmd', []);

      expect(result).toEqual({
        stdout: '',
        stderr: 'command not found',
        exit_code: 127,
      });
    });

    it('throws BOX_NOT_FOUND when the box does not exist on exec', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(client.exec('echo', ['hi'])).rejects.toMatchObject({
        code: 'BOX_NOT_FOUND',
        message: expect.stringContaining('BoxLite'),
      });
    });

    it('throws EXEC_FAILED when the server returns a non-OK status other than 404 on exec', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(client.exec('echo', ['hi'])).rejects.toMatchObject({
        code: 'EXEC_FAILED',
        message: expect.stringContaining('BoxLite'),
      });
    });

    it('throws BOXLITE_UNREACHABLE on network error during exec', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

      await expect(client.exec('echo', ['hi'])).rejects.toMatchObject({
        code: 'BOXLITE_UNREACHABLE',
        message: expect.stringContaining('BoxLite'),
      });
    });

    it('throws BOX_NOT_FOUND when output endpoint returns 404', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ execution_id: 'exec-3' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      await expect(client.exec('echo', ['hi'])).rejects.toMatchObject({
        code: 'BOX_NOT_FOUND',
      });
    });

    it('throws EXEC_FAILED when output endpoint returns non-OK status', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ execution_id: 'exec-4' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        });

      await expect(client.exec('echo', ['hi'])).rejects.toMatchObject({
        code: 'EXEC_FAILED',
      });
    });

    it('throws BOXLITE_UNREACHABLE on network error during polling', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ execution_id: 'exec-5' }),
        })
        .mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(client.exec('echo', ['hi'])).rejects.toMatchObject({
        code: 'BOXLITE_UNREACHABLE',
      });
    });

    it('throws EXEC_FAILED when polling times out', async () => {
      const stdoutB64 = Buffer.from('hello', 'utf-8').toString('base64');
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ execution_id: 'exec-6' }),
        })
        .mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => `${sseOutput('stdout', { data: stdoutB64 })}\n\n`,
        });

      await expect(client.exec('echo', ['hello'], { timeout: 0 })).rejects.toMatchObject({
        code: 'EXEC_FAILED',
        message: 'BoxLite exec timed out',
      });
    });

    it('calls cancel endpoint when polling times out', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ execution_id: 'exec-cancel' }),
        })
        .mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => `${sseOutput('stdout', { data: '' })}\n\n`,
        });

      await expect(client.exec('echo', ['hello'], { timeout: 0 })).rejects.toMatchObject({
        code: 'EXEC_FAILED',
      });

      const cancelCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/executions/exec-cancel/cancel'),
      );
      expect(cancelCall).toBeDefined();
      if (cancelCall) {
        expect(cancelCall[1]).toMatchObject({ method: 'POST' });
      }
    });

    it('throws EXEC_FAILED when aborted via signal', async () => {
      const controller = new AbortController();
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ execution_id: 'exec-abort' }),
      });

      const execPromise = client.exec('echo', ['hello'], { signal: controller.signal });
      controller.abort();

      await expect(execPromise).rejects.toMatchObject({
        code: 'EXEC_FAILED',
        message: 'BoxLite exec aborted',
      });

      const cancelCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/executions/exec-abort/cancel'),
      );
      expect(cancelCall).toBeDefined();
    });

    it('cancelExecution does not throw on failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));
      await expect(client.cancelExecution('exec-x')).resolves.toBeUndefined();
    });

    it('includes optional env, cwd, and timeout in the request body', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ execution_id: 'exec-7' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => `${sseOutput('exit', { exit_code: 0 })}\n\n`,
        });

      await client.exec('node', ['app.js'], {
        env: { NODE_ENV: 'test' },
        cwd: '/app',
        timeout: 5000,
      });

      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:8100/v1/default/boxes/test-box/exec',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'node',
            args: ['app.js'],
            env: { NODE_ENV: 'test' },
            cwd: '/app',
            timeout: 5000,
          }),
        },
      );
    });
  });

  describe('execStream', () => {
    it('yields incremental chunks until exit event appears', async () => {
      const stdoutA = Buffer.from('hello ', 'utf-8').toString('base64');
      const stdoutB = Buffer.from('world', 'utf-8').toString('base64');
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ execution_id: 'exec-stream-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => `${sseOutput('stdout', { data: stdoutA })}\n\n`,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            `${sseOutput('stdout', { data: stdoutB })}\n\n${sseOutput('exit', { exit_code: 0 })}\n\n`,
        });

      const chunks: Array<{ stdout: string; stderr: string; exit_code?: number }> = [];
      for await (const chunk of client.execStream('echo', ['hello'])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { stdout: 'hello ', stderr: '' },
        { stdout: 'world', stderr: '', exit_code: 0 },
      ]);
    });

    it('throws EXEC_FAILED on timeout and cancels execution', async () => {
      const stdout = Buffer.from('still running', 'utf-8').toString('base64');
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ execution_id: 'exec-stream-timeout' }),
        })
        .mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => `${sseOutput('stdout', { data: stdout })}\n\n`,
        });

      const readAll = async () => {
        for await (const _chunk of client.execStream('echo', ['hello'], { timeout: 0 })) {
        }
      };

      await expect(readAll()).rejects.toMatchObject({
        code: 'EXEC_FAILED',
        message: 'BoxLite exec timed out',
      });

      const cancelCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('/executions/exec-stream-timeout/cancel'),
      );
      expect(cancelCall).toBeDefined();
    });
  });
});
