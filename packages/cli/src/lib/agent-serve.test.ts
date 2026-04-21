import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AgentServeOptions, runAgentServeCommand } from './agent-serve.js';
import { BoxliteError } from './boxlite-client.js';
import type { CliConfig } from './config.js';

declare global {
  var __testServer: import('node:http').Server | undefined;
}

vi.mock('@fiber-pay/sdk/node', () => ({
  FiberRpcClient: class {},
  createL402Middleware: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));

const mockCheckBoxExists = vi.fn();
const mockExec = vi.fn();
const mockExecStream = vi.fn();

vi.mock('./boxlite-client.js', () => {
  class MockBoxliteError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'BoxliteError';
    }
  }

  function MockBoxliteClient() {
    return {
      checkBoxExists: mockCheckBoxExists,
      exec: mockExec,
      execStream: mockExecStream,
    };
  }

  return {
    BoxliteClient: MockBoxliteClient,
    BoxliteError: MockBoxliteError,
  };
});

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>();
  return {
    ...actual,
    createServer: vi.fn((...args: Parameters<typeof actual.createServer>) => {
      const server = actual.createServer(...args);
      globalThis.__testServer = server;
      return server;
    }),
  };
});

const baseConfig: CliConfig = {
  rpcUrl: 'http://localhost:8114',
  rpcBiscuitToken: 'test-token',
  network: 'testnet',
} as unknown as CliConfig;

const baseOptions: AgentServeOptions = {
  agent: 'codex',
  port: '0',
  host: '127.0.0.1',
  price: '0.1',
  expiry: '3600',
  timeout: '3600',
  rootKey: 'a'.repeat(64),
  boxliteUrl: 'http://localhost:8100',
  boxliteBoxId: 'test-box',
  // Disable namespace isolation in the base test config so that preflight
  // adds no extra exec calls and all existing call-index assertions remain
  // stable.  Isolation-specific behaviour is tested in describe('isolation').
  noIsolation: true,
};

function getTestServer() {
  return globalThis.__testServer;
}

async function startTestServer(options: Partial<AgentServeOptions> = {}) {
  mockCheckBoxExists.mockResolvedValue(true);

  const serverPromise = runAgentServeCommand(baseConfig, { ...baseOptions, ...options });

  await new Promise((r) => setTimeout(r, 50));

  const server = getTestServer() as import('node:http').Server;
  const addr = server.address() as import('node:net').AddressInfo;
  const url = `http://${addr.address}:${addr.port}`;

  return { server, url, serverPromise };
}

describe('runAgentServeCommand', () => {
  const originalExit = process.exit;

  beforeEach(() => {
    mockCheckBoxExists.mockReset();
    mockExec.mockReset();
    mockExecStream.mockReset();
    delete globalThis.__testServer;
    process.exit = vi.fn().mockImplementation((code: number) => {
      throw new Error(`process.exit(${code})`);
    }) as unknown as typeof process.exit;
  });

  afterEach(async () => {
    const server = getTestServer();
    if (server?.listening) {
      server.close();
    }
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  describe('startup', () => {
    it('succeeds when BoxLite responds correctly', async () => {
      mockCheckBoxExists.mockResolvedValue(true);
      mockExec.mockResolvedValue({ stdout: '1.0.0', stderr: '', exit_code: 0 });

      const serverPromise = runAgentServeCommand(baseConfig, baseOptions);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCheckBoxExists).toHaveBeenCalled();
      expect(mockExec).toHaveBeenCalledWith('acpx', ['--version'], { timeout: 10 });

      const server = getTestServer() as import('node:http').Server;
      expect(server).toBeDefined();
      expect(server.listening).toBe(true);
      server.close();
      serverPromise.catch(() => {});
    });

    it('exits with 1 when BoxLite is unreachable', async () => {
      mockCheckBoxExists.mockRejectedValue(
        new BoxliteError('BOXLITE_UNREACHABLE', 'Connection refused'),
      );

      await expect(runAgentServeCommand(baseConfig, baseOptions)).rejects.toThrow(
        'process.exit(1)',
      );
      expect(mockCheckBoxExists).toHaveBeenCalled();
    });

    it('exits with 1 when Box is not found', async () => {
      mockCheckBoxExists.mockResolvedValue(false);

      await expect(runAgentServeCommand(baseConfig, baseOptions)).rejects.toThrow(
        'process.exit(1)',
      );
      expect(mockCheckBoxExists).toHaveBeenCalled();
    });
  });

  describe('POST /', () => {
    it('returns 200 with agent response on successful exec', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'hello world', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'say hello' }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string; agent: string };
      expect(body.response).toBe('hello world');
      expect(body.agent).toBe('codex');

      server?.close();
    });

    it('streams SSE chunk/done events when stream mode is requested', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExecStream.mockReturnValueOnce(
        (async function* () {
          yield { stdout: 'hello ', stderr: '' };
          yield { stdout: 'world', stderr: '' };
          yield { stdout: '', stderr: '', exit_code: 0 };
        })(),
      );

      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ prompt: 'say hello', stream: 'sse' }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const body = await response.text();
      expect(body).toContain('event: chunk');
      expect(body).toContain('"type":"stdout"');
      expect(body).toContain('"text":"hello "');
      expect(body).toContain('"text":"world"');
      expect(body).toContain('event: done');
      expect(body).toContain('"agent":"codex"');

      server?.close();
    });

    it('streams SSE error event when execution fails in stream mode', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExecStream.mockReturnValueOnce({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            throw new BoxliteError('EXEC_FAILED', 'stream failed');
          },
        }),
      });

      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ prompt: 'fail stream', stream: 'sse' }),
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('event: error');
      expect(body).toContain('"code":"EXEC_FAILED"');
      expect(body).toContain('"message":"stream failed"');

      server?.close();
    });

    it('returns 502 with stderr on non-zero exit code', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'agent crashed', exit_code: 1 });

      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'fail' }),
      });

      expect(response.status).toBe(502);
      const body = (await response.json()) as { error: string; stderr: string };
      expect(body.error).toBe('Agent execution failed.');
      expect(body.stderr).toBe('agent crashed');

      server?.close();
    });

    it('passes sessionId to acpx via -s flag and ensures session first', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'ses_123\tcreated', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'hello session', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'say hello', sessionId: 'my-session-123' }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string; agent: string };
      expect(body.response).toBe('hello session');

      const ensureCall = mockExec.mock.calls[1];
      const ensureArgs = ensureCall[1] as string[];
      expect(ensureArgs).toEqual(['codex', 'sessions', 'ensure', '--name', 'my-session-123']);

      const agentExecCall = mockExec.mock.calls[2];
      const execArgs = agentExecCall[1] as string[];
      expect(execArgs).toContain('-s');
      expect(execArgs).toContain('my-session-123');
      expect(execArgs).not.toContain('exec');

      server?.close();
    });

    it('retries session prompt after closing and re-ensuring on failure', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'ses_123\tcreated', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'agent needs reconnect', exit_code: 1 });
      mockExec.mockResolvedValueOnce({ stdout: 'closed', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'ses_123\tcreated', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'hello retry', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'say hello', sessionId: 'my-session-123' }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string; agent: string };
      expect(body.response).toBe('hello retry');

      const closeCall = mockExec.mock.calls[3];
      expect(closeCall[1] as string[]).toEqual(['codex', 'sessions', 'close', 'my-session-123']);

      const retryEnsureCall = mockExec.mock.calls[4];
      expect(retryEnsureCall[1] as string[]).toEqual([
        'codex',
        'sessions',
        'ensure',
        '--name',
        'my-session-123',
      ]);

      const retryExecCall = mockExec.mock.calls[5];
      expect(retryExecCall[1] as string[]).toContain('-s');

      server?.close();
    });

    it('closes session when execPrompt throws a BoxliteError', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'ses_123\tcreated', stderr: '', exit_code: 0 });
      mockExec.mockRejectedValueOnce(new BoxliteError('EXEC_FAILED', 'BoxLite exec timed out'));
      mockExec.mockResolvedValueOnce({ stdout: 'closed', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'say hello', sessionId: 'my-session-123' }),
      });

      expect(response.status).toBe(502);

      const closeCall = mockExec.mock.calls.find(
        (call) =>
          (call[1] as string[]).includes('close') &&
          (call[1] as string[]).includes('my-session-123'),
      );
      expect(closeCall).toBeDefined();

      server?.close();
    });

    it('closes session when ensure throws a BoxliteError', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockRejectedValueOnce(new BoxliteError('EXEC_FAILED', 'BoxLite exec timed out'));
      mockExec.mockResolvedValueOnce({ stdout: 'closed', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'say hello', sessionId: 'my-session-123' }),
      });

      expect(response.status).toBe(502);

      const closeCalls = mockExec.mock.calls.filter(
        (call) =>
          (call[1] as string[]).includes('close') &&
          (call[1] as string[]).includes('my-session-123'),
      );
      expect(closeCalls.length).toBeGreaterThanOrEqual(1);

      server?.close();
    });

    it('passes format option to acpx and returns parsed data for json format', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({
        stdout: '{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","result":"done"}',
        stderr: '',
        exit_code: 0,
      });

      const { server, url } = await startTestServer({ format: 'json' });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test json' }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        response: string;
        agent: string;
        format: string;
        data: Array<Record<string, unknown>>;
      };
      expect(body.response).toBe('{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","result":"done"}');
      expect(body.format).toBe('json');
      expect(body.data).toEqual([
        { jsonrpc: '2.0', id: 1 },
        { jsonrpc: '2.0', result: 'done' },
      ]);

      const agentExecCall = mockExec.mock.calls[1];
      const execArgs = agentExecCall[1] as string[];
      expect(execArgs).toContain('--format');
      expect(execArgs).toContain('json');

      server?.close();
    });

    it('allows request body to override CLI format option', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'plain text', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer({ format: 'json' });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test override', format: 'quiet' }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string; format?: string };
      expect(body.response).toBe('plain text');
      expect(body.format).toBeUndefined();

      const agentExecCall = mockExec.mock.calls[1];
      const execArgs = agentExecCall[1] as string[];
      expect(execArgs).toContain('--format');
      expect(execArgs).toContain('quiet');

      server?.close();
    });

    it('does not pass FIBER_RPC_BISCUIT_TOKEN to BoxLite /exec', async () => {
      const originalFiberToken = process.env.FIBER_RPC_BISCUIT_TOKEN;
      const originalOpenaiKey = process.env.OPENAI_API_KEY;
      const originalPath = process.env.PATH;

      process.env.FIBER_RPC_BISCUIT_TOKEN = 'secret-token';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.PATH = '/usr/bin';

      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'ok', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test' }),
      });

      const agentExecCall = mockExec.mock.calls[1];
      const execOptions = agentExecCall[2] as {
        env?: Record<string, string>;
        cwd?: string;
        timeout?: number;
      };
      expect(execOptions.env).toBeDefined();
      const env = execOptions.env as Record<string, string>;
      expect(env.FIBER_RPC_BISCUIT_TOKEN).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBe('openai-key');
      expect(env.PATH).toBe('/usr/bin');
      expect(env.HOME).toBe('/home/boxlite');

      process.env.FIBER_RPC_BISCUIT_TOKEN = originalFiberToken;
      process.env.OPENAI_API_KEY = originalOpenaiKey;
      process.env.PATH = originalPath;

      server?.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Isolation-specific behaviour
  // ---------------------------------------------------------------------------
  describe('isolation', () => {
    // Helper: start a server with isolation ENABLED (noIsolation: false).
    // The caller must set up mockExec for the three preflight calls:
    //   [0] acpx --version, [1] sh mkdir, [2] unshare probe
    // Returns { server, url, serverPromise } so the test can stop the server.
    async function startIsolatedServer(extraOptions: Partial<AgentServeOptions> = {}) {
      mockCheckBoxExists.mockResolvedValue(true);
      const serverPromise = runAgentServeCommand(baseConfig, {
        ...baseOptions,
        noIsolation: false, // override base default
        ...extraOptions,
      });
      await new Promise((r) => setTimeout(r, 50));
      const server = getTestServer() as import('node:http').Server;
      const addr = server.address() as import('node:net').AddressInfo;
      const url = `http://${addr.address}:${addr.port}`;
      return { server, url, serverPromise };
    }

    it('wraps acpx with unshare when namespace probe succeeds', async () => {
      // Preflight: version OK, mkdir OK, unshare probe OK
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'isolation-probe-ok', stderr: '', exit_code: 0 });
      // Agent exec (will be wrapped with unshare)
      mockExec.mockResolvedValueOnce({ stdout: 'wrapped result', stderr: '', exit_code: 0 });
      // Default fallback for any subsequent fire-and-forget cleanup calls
      mockExec.mockResolvedValue({ stdout: '', stderr: '', exit_code: 0 });

      const { server, url, serverPromise } = await startIsolatedServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'say hello' }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string };
      expect(body.response).toBe('wrapped result');

      // The fourth exec call (index 3) should be the agent exec via 'unshare'
      const agentExecCall = mockExec.mock.calls[3];
      expect(agentExecCall[0]).toBe('unshare');
      const unshareArgs = agentExecCall[1] as string[];
      expect(unshareArgs).toContain('--user');
      expect(unshareArgs).toContain('--pid');
      expect(unshareArgs).toContain('--mount');
      expect(unshareArgs).toContain('--fork');
      expect(unshareArgs).toContain('--map-root-user');
      expect(unshareArgs).toContain('--mount-proc');
      // The sh -c script contains the acpx command and session dir
      const shScript = unshareArgs[unshareArgs.length - 1] as string;
      expect(shScript).toContain('acpx');
      expect(shScript).toContain('/workspace/sessions/');

      server.close();
      serverPromise.catch(() => {});
    });

    it('falls back to direct acpx exec when namespace probe fails', async () => {
      // Preflight: version OK, mkdir OK, unshare probe FAILS
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockRejectedValueOnce(new Error('operation not permitted'));
      // Agent exec falls back to direct acpx
      mockExec.mockResolvedValueOnce({ stdout: 'fallback result', stderr: '', exit_code: 0 });
      // Default fallback for any subsequent fire-and-forget cleanup calls
      mockExec.mockResolvedValue({ stdout: '', stderr: '', exit_code: 0 });

      const { server, url, serverPromise } = await startIsolatedServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'say hello' }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string };
      expect(body.response).toBe('fallback result');

      // No 'unshare' call should appear in the agent exec position
      const agentExecCall = mockExec.mock.calls[3];
      expect(agentExecCall[0]).toBe('acpx');

      server.close();
      serverPromise.catch(() => {});
    });

    it('skips mkdir and probe entirely when noIsolation is set', async () => {
      // Only the version check should fire during preflight
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'direct result', stderr: '', exit_code: 0 });

      // startTestServer uses baseOptions which has noIsolation: true
      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'say hello' }),
      });

      expect(response.status).toBe(200);

      // Exactly 2 exec calls total: version check + agent exec
      expect(mockExec).toHaveBeenCalledTimes(2);

      // No unshare calls at all
      const commands = mockExec.mock.calls.map((c) => c[0] as string);
      expect(commands).not.toContain('unshare');
      expect(commands[1]).toBe('acpx');

      server?.close();
    });

    it('session dir is cleaned up when a named session is closed', async () => {
      // Preflight: version, mkdir, probe OK
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'isolation-probe-ok', stderr: '', exit_code: 0 });
      // ensure, exec (fails so session gets closed), close
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 }); // ensure
      mockExec.mockRejectedValueOnce(new BoxliteError('EXEC_FAILED', 'timed out')); // exec throws
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 }); // close
      // Default fallback so the fire-and-forget rm -rf cleanup call succeeds
      mockExec.mockResolvedValue({ stdout: '', stderr: '', exit_code: 0 });

      const { server, url, serverPromise } = await startIsolatedServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'work', sessionId: 'cleanup-test' }),
      });

      expect(response.status).toBe(502);

      // A fire-and-forget rm -rf should have been issued for the session dirs
      await new Promise((r) => setTimeout(r, 20)); // let fire-and-forget settle
      const rmCall = mockExec.mock.calls.find(
        (call) => call[0] === 'sh' && (call[1] as string[])[1]?.includes('rm -rf'),
      );
      expect(rmCall).toBeDefined();
      const rmScript = (rmCall![1] as string[])[1];
      expect(rmScript).toContain('/workspace/sessions/cleanup-test');
      expect(rmScript).toContain('/tmp/fiber-sessions/cleanup-test');

      server.close();
      serverPromise.catch(() => {});
    });
  });
});

