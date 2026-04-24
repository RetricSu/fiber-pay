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
  proxyPort: '0',
  proxyHostAddr: '127.0.0.1',
};

interface SessionEnvelope {
  id: string;
  token: string;
  created: boolean;
}

function getTestServer() {
  return globalThis.__testServer;
}

function queueSuccessfulIsolationPreflight() {
  mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
  mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
  mockExec.mockResolvedValueOnce({ stdout: 'isolation-probe-ok', stderr: '', exit_code: 0 });
  mockExec.mockResolvedValueOnce({ stdout: '1000000 50%', stderr: '', exit_code: 0 });
  mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 }); // stale process cleanup
  mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 }); // npm pre-install
  mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 }); // npx prewarm
  mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 }); // daemon prewarm
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

function readSession(body: unknown): SessionEnvelope {
  if (
    !body ||
    typeof body !== 'object' ||
    !('session' in body) ||
    typeof (body as { session?: unknown }).session !== 'object' ||
    (body as { session?: unknown }).session === null
  ) {
    throw new Error('expected response.session');
  }

  const session = (body as { session: SessionEnvelope }).session;
  if (typeof session.id !== 'string' || typeof session.token !== 'string') {
    throw new Error('expected session.id and session.token');
  }

  return session;
}

describe('runAgentServeCommand', () => {
  const originalExit = process.exit;
  const originalProviderEnv: Record<string, string | undefined> = {};
  const providerEnvKeys = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'KIMI_API_KEY',
    'OPENCODE_API_KEY',
    'GEMINI_API_KEY',
  ] as const;

  beforeEach(() => {
    mockCheckBoxExists.mockReset();
    mockExec.mockReset();
    mockExecStream.mockReset();
    mockExec.mockResolvedValue({ stdout: '', stderr: '', exit_code: 0 });
    delete process.env.FIBER_PAY_ALLOW_INSECURE_NO_PROXY;
    for (const key of providerEnvKeys) {
      originalProviderEnv[key] = process.env[key];
      delete process.env[key];
    }
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
    for (const key of providerEnvKeys) {
      if (originalProviderEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalProviderEnv[key];
      }
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

    it('blocks --no-proxy unless explicit insecure env opt-in is set', async () => {
      await expect(
        runAgentServeCommand(baseConfig, {
          ...baseOptions,
          proxy: false,
        }),
      ).rejects.toThrow('process.exit(1)');

      expect(mockCheckBoxExists).not.toHaveBeenCalled();
    });

    it('blocks --no-proxy when host is not loopback even with env opt-in', async () => {
      process.env.FIBER_PAY_ALLOW_INSECURE_NO_PROXY = '1';

      await expect(
        runAgentServeCommand(baseConfig, {
          ...baseOptions,
          proxy: false,
          host: '0.0.0.0',
        }),
      ).rejects.toThrow('process.exit(1)');

      expect(mockCheckBoxExists).not.toHaveBeenCalled();
    });

    it('uses hour-based TTL for stale workspace cleanup', async () => {
      const scheduledTimers: Array<{
        id: number;
        timeout: number;
        handler: Parameters<typeof setInterval>[0];
      }> = [];
      let nextTimerId = 1;

      vi.spyOn(global, 'setInterval').mockImplementation(((handler, timeout) => {
        const id = nextTimerId++;
        scheduledTimers.push({
          id,
          timeout: Number(timeout ?? 0),
          handler,
        });
        return id as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval);

      vi.spyOn(global, 'clearInterval').mockImplementation((() => {}) as typeof clearInterval);

      queueSuccessfulIsolationPreflight();
      const { server, serverPromise } = await startTestServer({ workspaceTtl: '24' });

      expect(scheduledTimers).toHaveLength(1);
      expect(scheduledTimers[0]?.timeout).toBe(60 * 60 * 1000);

      const cleanupHandler = scheduledTimers[0]?.handler;
      if (typeof cleanupHandler !== 'function') {
        throw new Error('expected cleanup handler to be a function');
      }
      await cleanupHandler();

      const cleanupCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'sh' &&
          Array.isArray(call[1]) &&
          typeof (call[1] as string[])[1] === 'string' &&
          ((call[1] as string[])[1] as string).includes(
            'find /workspace/sessions /tmp/fiber-sessions',
          ),
      );
      expect(cleanupCall).toBeDefined();
      const cleanupScript = ((cleanupCall?.[1] as string[]) || [])[1] || '';
      expect(cleanupScript).toContain('-mmin +1440');

      server.close();
      serverPromise.catch(() => {});
    });

    it('re-arms cleanup interval to 10 minutes under disk pressure', async () => {
      const scheduledTimers: Array<{
        id: number;
        timeout: number;
        handler: Parameters<typeof setInterval>[0];
      }> = [];
      const clearedTimers: number[] = [];
      let nextTimerId = 1;

      vi.spyOn(global, 'setInterval').mockImplementation(((handler, timeout) => {
        const id = nextTimerId++;
        scheduledTimers.push({
          id,
          timeout: Number(timeout ?? 0),
          handler,
        });
        return id as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval);

      vi.spyOn(global, 'clearInterval').mockImplementation(((timer) => {
        clearedTimers.push(Number(timer));
      }) as typeof clearInterval);

      queueSuccessfulIsolationPreflight();
      mockExec.mockResolvedValueOnce({ stdout: '100000 92%', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });

      const { server, serverPromise } = await startTestServer({ workspaceTtl: '24' });

      const firstTimer = scheduledTimers[0];
      expect(firstTimer?.timeout).toBe(60 * 60 * 1000);

      if (!firstTimer || typeof firstTimer.handler !== 'function') {
        throw new Error('expected first cleanup timer handler to be a function');
      }
      await firstTimer.handler();

      expect(clearedTimers).toContain(firstTimer.id);
      expect(scheduledTimers).toHaveLength(2);
      expect(scheduledTimers[1]?.timeout).toBe(10 * 60 * 1000);

      const cleanupCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'sh' &&
          Array.isArray(call[1]) &&
          typeof (call[1] as string[])[1] === 'string' &&
          ((call[1] as string[])[1] as string).includes(
            'find /workspace/sessions /tmp/fiber-sessions',
          ),
      );
      expect(cleanupCall).toBeDefined();
      const cleanupScript = ((cleanupCall?.[1] as string[]) || [])[1] || '';
      expect(cleanupScript).toContain('-mmin +60');

      server.close();
      serverPromise.catch(() => {});
    });

    it('reverts cleanup interval back to 1 hour after disk pressure subsides', async () => {
      const scheduledTimers: Array<{
        id: number;
        timeout: number;
        handler: Parameters<typeof setInterval>[0];
      }> = [];
      const clearedTimers: number[] = [];
      let nextTimerId = 1;

      vi.spyOn(global, 'setInterval').mockImplementation(((handler, timeout) => {
        const id = nextTimerId++;
        scheduledTimers.push({
          id,
          timeout: Number(timeout ?? 0),
          handler,
        });
        return id as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval);

      vi.spyOn(global, 'clearInterval').mockImplementation(((timer) => {
        clearedTimers.push(Number(timer));
      }) as typeof clearInterval);

      queueSuccessfulIsolationPreflight();
      const { server, serverPromise } = await startTestServer({ workspaceTtl: '24' });

      const diskStates = ['500000 92%', '500000 50%'];
      mockExec.mockImplementation(async (command, args) => {
        if (
          command === 'sh' &&
          Array.isArray(args) &&
          args[0] === '-c' &&
          typeof args[1] === 'string'
        ) {
          const script = args[1] as string;
          if (script.includes('df -P /workspace')) {
            return {
              stdout: diskStates.shift() ?? '100000 50%',
              stderr: '',
              exit_code: 0,
            };
          }
          if (script.includes('find /workspace/sessions /tmp/fiber-sessions')) {
            return { stdout: '', stderr: '', exit_code: 0 };
          }
        }
        return { stdout: '', stderr: '', exit_code: 0 };
      });

      const firstTimer = scheduledTimers[0];
      if (!firstTimer || typeof firstTimer.handler !== 'function') {
        throw new Error('expected first cleanup timer handler to be a function');
      }
      await firstTimer.handler();

      const pressureTimer = scheduledTimers[1];
      expect(pressureTimer?.timeout).toBe(10 * 60 * 1000);

      if (!pressureTimer || typeof pressureTimer.handler !== 'function') {
        throw new Error('expected pressure cleanup timer handler to be a function');
      }
      await pressureTimer.handler();

      expect(clearedTimers).toContain(firstTimer.id);
      expect(clearedTimers).toContain(pressureTimer.id);
      expect(scheduledTimers).toHaveLength(3);
      expect(scheduledTimers[2]?.timeout).toBe(60 * 60 * 1000);

      const cleanupCalls = mockExec.mock.calls.filter(
        (call) =>
          call[0] === 'sh' &&
          Array.isArray(call[1]) &&
          typeof (call[1] as string[])[1] === 'string' &&
          ((call[1] as string[])[1] as string).includes(
            'find /workspace/sessions /tmp/fiber-sessions',
          ),
      );
      expect(cleanupCalls.length).toBeGreaterThanOrEqual(2);
      const lastCleanupScript = ((cleanupCalls.at(-1)?.[1] as string[]) || [])[1] || '';
      expect(lastCleanupScript).toContain('-mmin +1440');

      server.close();
      serverPromise.catch(() => {});
    });
  });

  describe('POST /', () => {
    beforeEach(() => {
      queueSuccessfulIsolationPreflight();
    });

    it('returns 200 with agent response on successful exec', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'hello world', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'say hello' }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string; agent: string; session: unknown };
      expect(body.response).toBe('hello world');
      expect(body.agent).toBe('codex');
      const session = readSession(body);
      expect(session.created).toBe(true);

      server?.close();
    });

    it('streams SSE chunk/done events when stream mode is requested', async () => {
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

    it('filters reconnect advisory stderr from SSE chunks', async () => {
      mockExecStream.mockReturnValueOnce(
        (async function* () {
          yield { stdout: 'hello', stderr: '' };
          yield {
            stdout: '',
            stderr:
              '[acpx] session sess-123 (ses_123) · /workspace · agent needs reconnect\n[unshare] seccomp not available\n',
          };
          yield { stdout: '', stderr: 'real warning\n' };
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
      const body = await response.text();
      expect(body).toContain('event: chunk');
      expect(body).toContain('"type":"stderr"');
      expect(body).toContain('real warning');
      expect(body).not.toContain('agent needs reconnect');
      expect(body).not.toContain('seccomp not available');

      server?.close();
    });

    it('streams SSE error event when execution fails in stream mode', async () => {
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
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'agent crashed', exit_code: 1 });
      mockExec.mockResolvedValueOnce({ stdout: 'closed', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'agent crashed again', exit_code: 1 });

      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'fail' }),
      });

      expect(response.status).toBe(502);
      const body = (await response.json()) as { error: string; stderr: string };
      expect(body.error).toBe('Agent execution failed.');
      expect(body.stderr).toContain('agent crashed');

      server?.close();
    });

    it('reuses a server-issued session when sessionId and sessionToken are provided', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const firstResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });
      expect(firstResponse.status).toBe(200);
      const firstBody = (await firstResponse.json()) as { session: unknown };
      const session = readSession(firstBody);

      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'hello session', stderr: '', exit_code: 0 });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'say hello',
          sessionId: session.id,
          sessionToken: session.token,
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string; agent: string };
      expect(body.response).toBe('hello session');

      const ensureCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'unshare' &&
          typeof (call[1] as string[]).at(-1) === 'string' &&
          ((call[1] as string[]).at(-1) as string).includes('sessions') &&
          ((call[1] as string[]).at(-1) as string).includes('ensure') &&
          ((call[1] as string[]).at(-1) as string).includes(session.id),
      );
      expect(ensureCall).toBeDefined();
      const ensureScript = ((ensureCall?.[1] as string[]) || []).at(-1) || '';
      expect(ensureScript).toContain('acpx');
      expect(ensureScript).toContain('sessions');
      expect(ensureScript).toContain('ensure');
      expect(ensureScript).toContain(session.id);

      const agentExecCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'unshare' &&
          typeof (call[1] as string[]).at(-1) === 'string' &&
          ((call[1] as string[]).at(-1) as string).includes(session.id),
      );
      expect(agentExecCall).toBeDefined();
      const shScript = ((agentExecCall?.[1] as string[]) || []).at(-1) || '';
      expect(shScript).toContain('-s');
      expect(shScript).toContain(session.id);
      expect(shScript).not.toContain("'exec'");

      server?.close();
    });

    it('retries session prompt after closing and re-ensuring on failure', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const firstResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });

      expect(firstResponse.status).toBe(200);
      const firstBody = (await firstResponse.json()) as { session: unknown };
      const session = readSession(firstBody);

      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'agent needs reconnect', exit_code: 1 });
      mockExec.mockResolvedValueOnce({ stdout: 'closed', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'hello retry', stderr: '', exit_code: 0 });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'say hello',
          sessionId: session.id,
          sessionToken: session.token,
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string; agent: string };
      expect(body.response).toBe('hello retry');

      const closeCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'sh' &&
          (call[1] as string[])[1]?.includes('sessions close') &&
          (call[1] as string[])[1]?.includes(session.id),
      );
      expect(closeCall).toBeDefined();

      const ensureCalls = mockExec.mock.calls.filter(
        (call) =>
          call[0] === 'unshare' &&
          typeof (call[1] as string[]).at(-1) === 'string' &&
          ((call[1] as string[]).at(-1) as string).includes('sessions') &&
          ((call[1] as string[]).at(-1) as string).includes('ensure') &&
          ((call[1] as string[]).at(-1) as string).includes(session.id),
      );
      expect(ensureCalls.length).toBeGreaterThanOrEqual(2);

      const execCalls = mockExec.mock.calls.filter(
        (call) =>
          call[0] === 'unshare' &&
          typeof (call[1] as string[]).at(-1) === 'string' &&
          ((call[1] as string[]).at(-1) as string).includes(session.id),
      );
      expect(execCalls.length).toBeGreaterThanOrEqual(2);

      server?.close();
    });

    it('retries when acpx reports reconnect-needed with empty output', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const firstResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });

      expect(firstResponse.status).toBe(200);
      const firstBody = (await firstResponse.json()) as { session: unknown };
      const session = readSession(firstBody);

      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'agent needs reconnect', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'hello after reconnect', stderr: '', exit_code: 0 });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'say hello',
          sessionId: session.id,
          sessionToken: session.token,
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string };
      expect(body.response).toBe('hello after reconnect');

      const closeCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'sh' &&
          (call[1] as string[])[1]?.includes('sessions close') &&
          (call[1] as string[])[1]?.includes(session.id),
      );
      expect(closeCall).toBeUndefined();

      server?.close();
    });

    it('does not perform immediate retry when reconnect hint stderr includes non-ignorable output', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const firstResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });

      expect(firstResponse.status).toBe(200);
      const firstBody = (await firstResponse.json()) as { session: unknown };
      const session = readSession(firstBody);

      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 }); // ensure
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'agent needs reconnect\nreal warning\n',
        exit_code: 0,
      }); // exec #1 should be returned as-is

      const unshareSessionCallsBefore = mockExec.mock.calls.filter(
        (call) =>
          call[0] === 'unshare' &&
          typeof (call[1] as string[]).at(-1) === 'string' &&
          ((call[1] as string[]).at(-1) as string).includes(session.id),
      ).length;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'say hello',
          sessionId: session.id,
          sessionToken: session.token,
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string };
      expect(body.response).toBe('');

      const closeCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'sh' &&
          (call[1] as string[])[1]?.includes('sessions close') &&
          (call[1] as string[])[1]?.includes(session.id),
      );
      expect(closeCall).toBeUndefined();

      const unshareSessionCallsAfter = mockExec.mock.calls.filter(
        (call) =>
          call[0] === 'unshare' &&
          typeof (call[1] as string[]).at(-1) === 'string' &&
          ((call[1] as string[]).at(-1) as string).includes(session.id),
      ).length;
      expect(unshareSessionCallsAfter - unshareSessionCallsBefore).toBe(2);

      server?.close();
    });

    it('falls back to hard reset when reconnect warning persists after immediate retry', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const firstResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });

      expect(firstResponse.status).toBe(200);
      const firstBody = (await firstResponse.json()) as { session: unknown };
      const session = readSession(firstBody);

      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 }); // ensure
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'agent needs reconnect', exit_code: 0 }); // exec #1
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'agent needs reconnect', exit_code: 0 }); // exec #2
      mockExec.mockResolvedValueOnce({ stdout: 'closed', stderr: '', exit_code: 0 }); // close
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 }); // rm -rf cleanup
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 }); // ensure after reset
      mockExec.mockResolvedValueOnce({
        stdout: 'hello after hard reset',
        stderr: '',
        exit_code: 0,
      }); // exec #3

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'say hello',
          sessionId: session.id,
          sessionToken: session.token,
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { response: string };
      expect(body.response).toBe('hello after hard reset');

      const closeCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'sh' &&
          (call[1] as string[])[1]?.includes('sessions close') &&
          (call[1] as string[])[1]?.includes(session.id),
      );
      expect(closeCall).toBeDefined();

      server?.close();
    });

    it('closes session when execPrompt throws a BoxliteError', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const firstResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });

      expect(firstResponse.status).toBe(200);
      const firstBody = (await firstResponse.json()) as { session: unknown };
      const session = readSession(firstBody);

      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockRejectedValueOnce(new BoxliteError('EXEC_FAILED', 'BoxLite exec timed out'));
      mockExec.mockResolvedValueOnce({ stdout: 'closed', stderr: '', exit_code: 0 });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'say hello',
          sessionId: session.id,
          sessionToken: session.token,
        }),
      });

      expect(response.status).toBe(502);

      const closeCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'sh' &&
          (call[1] as string[])[1]?.includes('sessions close') &&
          (call[1] as string[])[1]?.includes(session.id),
      );
      expect(closeCall).toBeDefined();

      server?.close();
    });

    it('closes session when ensure throws a BoxliteError', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const firstResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });

      expect(firstResponse.status).toBe(200);
      const firstBody = (await firstResponse.json()) as { session: unknown };
      const session = readSession(firstBody);

      mockExec.mockRejectedValueOnce(new BoxliteError('EXEC_FAILED', 'BoxLite exec timed out'));
      mockExec.mockResolvedValueOnce({ stdout: 'closed', stderr: '', exit_code: 0 });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'say hello',
          sessionId: session.id,
          sessionToken: session.token,
        }),
      });

      expect(response.status).toBe(502);

      const closeCalls = mockExec.mock.calls.filter(
        (call) =>
          call[0] === 'sh' &&
          (call[1] as string[])[1]?.includes('sessions close') &&
          (call[1] as string[])[1]?.includes(session.id),
      );
      expect(closeCalls.length).toBeGreaterThanOrEqual(1);

      server?.close();
    });

    it('passes format option to acpx and returns parsed data for json format', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
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

      const agentExecCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'unshare' && ((call[1] as string[]).at(-1) as string).includes('test json'),
      );
      expect(agentExecCall).toBeDefined();
      const shScript = ((agentExecCall?.[1] as string[]) || []).at(-1) || '';
      expect(shScript).toContain('--format');
      expect(shScript).toContain('json');

      server?.close();
    });

    it('allows request body to override CLI format option', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
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

      const agentExecCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'unshare' &&
          typeof (call[1] as string[]).at(-1) === 'string' &&
          ((call[1] as string[]).at(-1) as string).includes('test override'),
      );
      expect(agentExecCall).toBeDefined();
      const shScript = ((agentExecCall?.[1] as string[]) || []).at(-1) || '';
      expect(shScript).toContain('--format');
      expect(shScript).toContain('quiet');

      server?.close();
    });

    it('does not pass FIBER_RPC_BISCUIT_TOKEN to BoxLite /exec', async () => {
      const originalFiberToken = process.env.FIBER_RPC_BISCUIT_TOKEN;
      const originalOpenaiKey = process.env.OPENAI_API_KEY;
      const originalPath = process.env.PATH;

      process.env.FIBER_RPC_BISCUIT_TOKEN = 'secret-token';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.PATH = '/usr/bin';

      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'ok', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test' }),
      });

      const agentExecCall = mockExec.mock.calls.find((call) => {
        if (call[0] !== 'unshare') {
          return false;
        }
        const script = ((call[1] as string[]) || []).at(-1);
        return typeof script === 'string' && script.includes('exec') && script.includes('test');
      });
      expect(agentExecCall).toBeDefined();
      if (!agentExecCall) {
        throw new Error('expected unshare call for agent execution');
      }
      const execOptions = agentExecCall[2] as {
        env?: Record<string, string>;
        cwd?: string;
        timeout?: number;
      };
      expect(execOptions.env).toBeDefined();
      const env = execOptions.env as Record<string, string>;
      expect(env.FIBER_RPC_BISCUIT_TOKEN).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBe('fp-shim-placeholder');
      expect(env.PATH).toBe('/usr/bin');
      expect(env.HOME).toBe('/home/boxlite');

      process.env.FIBER_RPC_BISCUIT_TOKEN = originalFiberToken;
      process.env.OPENAI_API_KEY = originalOpenaiKey;
      process.env.PATH = originalPath;

      server?.close();
    });

    it('rejects sessionId without sessionToken', async () => {
      const { server, url } = await startTestServer();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello', sessionId: 'sess-test' }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe('SESSION_MISSING_TOKEN');

      server?.close();
    });

    it('rejects a tampered sessionToken', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const firstResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });

      expect(firstResponse.status).toBe(200);
      const firstBody = (await firstResponse.json()) as { session: unknown };
      const session = readSession(firstBody);
      const tampered = `${session.token}tampered`;

      const secondResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'hello',
          sessionId: session.id,
          sessionToken: tampered,
        }),
      });

      expect(secondResponse.status).toBe(403);
      const secondBody = (await secondResponse.json()) as { code?: string };
      expect(secondBody.code).toBe('SESSION_INVALID_TOKEN');

      server?.close();
    });
  });

  describe('GET /workspace/static', () => {
    beforeEach(() => {
      queueSuccessfulIsolationPreflight();
    });

    it('serves a workspace file when session token is valid', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });
      const html = '<!doctype html><h1>ok</h1>';
      const base64 = Buffer.from(html, 'utf-8').toString('base64');
      mockExec.mockResolvedValueOnce({
        stdout: `__META__:${Buffer.byteLength(html, 'utf-8')}:1710000000\n${base64}\n`,
        stderr: '',
        exit_code: 0,
      });

      const { server, url } = await startTestServer();

      const sessionResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });
      expect(sessionResponse.status).toBe(200);
      const sessionBody = (await sessionResponse.json()) as { session: unknown };
      const session = readSession(sessionBody);

      const response = await fetch(`${url}/workspace/static/index.html`, {
        headers: {
          'x-session-id': session.id,
          'x-session-token': session.token,
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(await response.text()).toBe(html);

      server?.close();
    });

    it('rejects workspace static request without session token', async () => {
      const { server, url } = await startTestServer();

      const response = await fetch(`${url}/workspace/static/index.html`, {
        headers: {
          'x-session-id': 'sess-test',
        },
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe('SESSION_MISSING_TOKEN');

      server?.close();
    });

    it('rejects workspace static request with tampered session token', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const sessionResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });
      expect(sessionResponse.status).toBe(200);
      const sessionBody = (await sessionResponse.json()) as { session: unknown };
      const session = readSession(sessionBody);

      const response = await fetch(`${url}/workspace/static/index.html`, {
        headers: {
          'x-session-id': session.id,
          'x-session-token': `${session.token}tampered`,
        },
      });

      expect(response.status).toBe(403);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe('SESSION_INVALID_TOKEN');

      server?.close();
    });

    it('rejects path traversal for workspace static request', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const sessionResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });
      expect(sessionResponse.status).toBe(200);
      const sessionBody = (await sessionResponse.json()) as { session: unknown };
      const session = readSession(sessionBody);

      const response = await fetch(`${url}/workspace/static/..%2F..%2Fetc%2Fpasswd`, {
        headers: {
          'x-session-id': session.id,
          'x-session-token': session.token,
        },
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe('WORKSPACE_STATIC_INVALID_PATH');

      server?.close();
    });

    it('returns 413 when workspace static file exceeds size limit', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({
        stdout: '__ERR__:TOO_LARGE:7340032\n',
        stderr: '',
        exit_code: 0,
      });

      const { server, url } = await startTestServer();

      const sessionResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });
      expect(sessionResponse.status).toBe(200);
      const sessionBody = (await sessionResponse.json()) as { session: unknown };
      const session = readSession(sessionBody);

      const response = await fetch(`${url}/workspace/static/big.bin`, {
        headers: {
          'x-session-id': session.id,
          'x-session-token': session.token,
        },
      });

      expect(response.status).toBe(413);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe('WORKSPACE_STATIC_TOO_LARGE');

      server?.close();
    });

    it('falls back to index.html for workspace static directory path', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });
      const html = '<html>index</html>';
      const base64 = Buffer.from(html, 'utf-8').toString('base64');
      mockExec.mockResolvedValueOnce({
        stdout: `__META__:${Buffer.byteLength(html, 'utf-8')}:1710000000\n${base64}\n`,
        stderr: '',
        exit_code: 0,
      });

      const { server, url } = await startTestServer();

      const sessionResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });
      expect(sessionResponse.status).toBe(200);
      const sessionBody = (await sessionResponse.json()) as { session: unknown };
      const session = readSession(sessionBody);

      const response = await fetch(`${url}/workspace/static`, {
        headers: {
          'x-session-id': session.id,
          'x-session-token': session.token,
        },
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(html);

      server?.close();
    });
  });

  describe('GET /workspace/static/list', () => {
    beforeEach(() => {
      queueSuccessfulIsolationPreflight();
    });

    it('lists root workspace directory entries when session token is valid', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });
      const dirName = Buffer.from('assets', 'utf-8').toString('base64');
      const fileName = Buffer.from('index.html', 'utf-8').toString('base64');
      mockExec.mockResolvedValueOnce({
        stdout:
          `__ENTRY__:${dirName}:dir:0:1710000001\n` +
          `__ENTRY__:${fileName}:file:512:1710000002\n` +
          '__TRUNCATED__:0\n',
        stderr: '',
        exit_code: 0,
      });

      const { server, url } = await startTestServer();

      const sessionResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });
      expect(sessionResponse.status).toBe(200);
      const sessionBody = (await sessionResponse.json()) as { session: unknown };
      const session = readSession(sessionBody);

      const response = await fetch(`${url}/workspace/static/list`, {
        headers: {
          'x-session-id': session.id,
          'x-session-token': session.token,
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      const body = (await response.json()) as {
        entries: Array<{ name: string; path: string; type: string }>;
        truncated: boolean;
      };
      expect(body.truncated).toBe(false);
      expect(body.entries.map((entry) => entry.name)).toEqual(['assets', 'index.html']);
      expect(body.entries[0]?.type).toBe('dir');
      expect(body.entries[1]?.path).toBe('index.html');

      const listCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'sh' &&
          Array.isArray(call[1]) &&
          (call[1] as string[])[0] === '-c' &&
          typeof (call[1] as string[])[1] === 'string' &&
          ((call[1] as string[])[1] as string).includes('__ENTRY__'),
      );
      expect(listCall).toBeDefined();
      const listScript = ((listCall?.[1] as string[]) || [])[1] || '';
      expect(listScript).toContain('find "$REAL_DIR" -mindepth 1 -maxdepth 1 -print');
      expect(listScript).toContain('while IFS= read -r ENTRY; do');

      server?.close();
    });

    it('lists sub-directory when path query is provided', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });
      const fileName = Buffer.from('main.ts', 'utf-8').toString('base64');
      mockExec.mockResolvedValueOnce({
        stdout: `__ENTRY__:${fileName}:file:128:1710000003\n__TRUNCATED__:0\n`,
        stderr: '',
        exit_code: 0,
      });

      const { server, url } = await startTestServer();

      const sessionResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });
      const sessionBody = (await sessionResponse.json()) as { session: unknown };
      const session = readSession(sessionBody);

      const response = await fetch(
        `${url}/workspace/static/list?path=${encodeURIComponent('src')}`,
        {
          headers: {
            'x-session-id': session.id,
            'x-session-token': session.token,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { path: string; entries: Array<{ path: string }> };
      expect(body.path).toBe('src');
      expect(body.entries[0]?.path).toBe('src/main.ts');

      server?.close();
    });

    it('rejects directory listing with invalid path traversal query', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });

      const { server, url } = await startTestServer();

      const sessionResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });
      const sessionBody = (await sessionResponse.json()) as { session: unknown };
      const session = readSession(sessionBody);

      const response = await fetch(
        `${url}/workspace/static/list?path=${encodeURIComponent('../etc')}`,
        {
          headers: {
            'x-session-id': session.id,
            'x-session-token': session.token,
          },
        },
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe('WORKSPACE_LIST_INVALID_PATH');

      server?.close();
    });

    it('returns 400 when listing path points to a file', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({
        stdout: '__ERR__:NOT_DIRECTORY\n',
        stderr: '',
        exit_code: 0,
      });

      const { server, url } = await startTestServer();

      const sessionResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });
      const sessionBody = (await sessionResponse.json()) as { session: unknown };
      const session = readSession(sessionBody);

      const response = await fetch(
        `${url}/workspace/static/list?path=${encodeURIComponent('index.html')}`,
        {
          headers: {
            'x-session-id': session.id,
            'x-session-token': session.token,
          },
        },
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe('WORKSPACE_LIST_NOT_DIRECTORY');

      server?.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Isolation-specific behaviour
  // ---------------------------------------------------------------------------
  describe('isolation', () => {
    // The caller must set up mockExec for preflight calls in order:
    //   [0] acpx --version, [1] sh mkdir, [2] unshare probe, [3] disk check
    // Returns { server, url, serverPromise } so the test can stop the server.
    async function startIsolatedServer(extraOptions: Partial<AgentServeOptions> = {}) {
      mockCheckBoxExists.mockResolvedValue(true);
      const serverPromise = runAgentServeCommand(baseConfig, {
        ...baseOptions,
        ...extraOptions,
      });
      await new Promise((r) => setTimeout(r, 50));
      const server = getTestServer() as import('node:http').Server;
      const addr = server.address() as import('node:net').AddressInfo;
      const url = `http://${addr.address}:${addr.port}`;
      return { server, url, serverPromise };
    }

    it('wraps acpx with unshare when namespace probe succeeds', async () => {
      queueSuccessfulIsolationPreflight();
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
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

      const unshareCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'unshare' &&
          typeof (call[1] as string[]).at(-1) === 'string' &&
          ((call[1] as string[]).at(-1) as string).includes('say hello'),
      );
      expect(unshareCall).toBeDefined();
      if (!unshareCall) {
        throw new Error('expected unshare call for agent execution');
      }
      expect(unshareCall[0]).toBe('unshare');
      const unshareArgs = unshareCall[1] as string[];
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

    it('exits with 1 when namespace probe fails', async () => {
      mockCheckBoxExists.mockResolvedValue(true);
      mockExec.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockRejectedValueOnce(new Error('operation not permitted'));
      await expect(runAgentServeCommand(baseConfig, baseOptions)).rejects.toThrow(
        'process.exit(1)',
      );
    });

    it('session dir is cleaned up when a named session is closed', async () => {
      queueSuccessfulIsolationPreflight();
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValueOnce({ stdout: 'bootstrap', stderr: '', exit_code: 0 });
      mockExec.mockResolvedValue({ stdout: '', stderr: '', exit_code: 0 });

      const { server, url, serverPromise } = await startIsolatedServer();

      const firstResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'bootstrap' }),
      });
      expect(firstResponse.status).toBe(200);
      const firstBody = (await firstResponse.json()) as { session: unknown };
      const session = readSession(firstBody);

      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
      mockExec.mockRejectedValueOnce(new BoxliteError('EXEC_FAILED', 'timed out'));
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'work',
          sessionId: session.id,
          sessionToken: session.token,
        }),
      });

      expect(response.status).toBe(502);

      // A fire-and-forget rm -rf should have been issued for the session dirs
      await new Promise((r) => setTimeout(r, 20)); // let fire-and-forget settle
      const rmCall = mockExec.mock.calls.find(
        (call) =>
          call[0] === 'sh' &&
          (call[1] as string[])[1]?.includes('rm -rf') &&
          (call[1] as string[])[1]?.includes(`/workspace/sessions/${session.id}`),
      );
      expect(rmCall).toBeDefined();
      const rmScript = (rmCall?.[1] as string[])[1];
      expect(rmScript).toContain(`/workspace/sessions/${session.id}`);
      expect(rmScript).toContain(`/tmp/fiber-sessions/${session.id}`);

      server.close();
      serverPromise.catch(() => {});
    });
  });
});
