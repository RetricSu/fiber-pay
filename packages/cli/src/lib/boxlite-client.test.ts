import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxliteClient, BoxliteError } from './boxlite-client.js';

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
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          stdout: 'hello',
          stderr: '',
          exit_code: 0,
        }),
      });

      const result = await client.exec('echo', ['hello']);

      expect(result).toEqual({
        stdout: 'hello',
        stderr: '',
        exit_code: 0,
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8100/v1/default/boxes/test-box/exec',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'echo', args: ['hello'] }),
        },
      );
    });

    it('returns non-zero exit code when command fails on the server', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          stdout: '',
          stderr: 'command not found',
          exit_code: 127,
        }),
      });

      const result = await client.exec('missing-cmd', []);

      expect(result).toEqual({
        stdout: '',
        stderr: 'command not found',
        exit_code: 127,
      });
    });

    it('throws BOX_NOT_FOUND when the box does not exist', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(client.exec('echo', ['hi'])).rejects.toThrow(BoxliteError);
      await expect(client.exec('echo', ['hi'])).rejects.toMatchObject({
        code: 'BOX_NOT_FOUND',
        message: expect.stringContaining('BoxLite'),
      });
    });

    it('throws EXEC_FAILED when the server returns a non-OK status other than 404', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(client.exec('echo', ['hi'])).rejects.toThrow(BoxliteError);
      await expect(client.exec('echo', ['hi'])).rejects.toMatchObject({
        code: 'EXEC_FAILED',
        message: expect.stringContaining('BoxLite'),
      });
    });

    it('throws BOXLITE_UNREACHABLE on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

      await expect(client.exec('echo', ['hi'])).rejects.toThrow(BoxliteError);
      await expect(client.exec('echo', ['hi'])).rejects.toMatchObject({
        code: 'BOXLITE_UNREACHABLE',
        message: expect.stringContaining('BoxLite'),
      });
    });

    it('includes optional env, cwd, and timeout in the request body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          stdout: '',
          stderr: '',
          exit_code: 0,
        }),
      });

      await client.exec('node', ['app.js'], {
        env: { NODE_ENV: 'test' },
        cwd: '/app',
        timeout: 5000,
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
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
});
