/**
 * Agent Serve — L402-gated AI Agent HTTP Service
 *
 * Starts an Express server that:
 * 1. Gates all requests behind L402 payment via createL402Middleware()
 * 2. On paid POST /, runs `acpx <agent> exec --format quiet '<prompt>'` inside a BoxLite sandbox
 * 3. Returns the agent's response as JSON
 */

import { createServer, type Server } from 'node:http';
import type { Currency } from '@fiber-pay/sdk';
import { createL402Middleware, FiberRpcClient } from '@fiber-pay/sdk/node';
import cors from 'cors';
import express from 'express';
import { BoxliteClient, BoxliteError } from './boxlite-client.js';
import type { CliConfig } from './config.js';
import { printJsonError, printJsonSuccess } from './format.js';

export interface AgentServeOptions {
  agent: string;
  port: string;
  host: string;
  price: string;
  rootKey?: string;
  expiry: string;
  cwd?: string;
  approveAll?: boolean;
  timeout: string;
  format?: string;
  boxliteUrl?: string;
  boxliteBoxId?: string;
  json?: boolean;
}

interface AgentServeRequest extends express.Request {
  l402?: { valid?: boolean; paymentHash?: string; preimage?: string };
  _fiberPayRequestId?: number;
}

function getClientIp(req: AgentServeRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof forwardedValue === 'string' && forwardedValue.trim().length > 0) {
    return forwardedValue.split(',')[0]?.trim() || 'unknown';
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

function summarizeL402Status(req: AgentServeRequest): string {
  if (req.l402?.valid) {
    if (req.l402.paymentHash) {
      return `payment-verified:${req.l402.paymentHash.slice(0, 14)}...`;
    }
    if (req.l402.preimage) {
      return 'payment-verified:preimage';
    }
    return 'payment-verified';
  }

  return 'no-l402-token';
}

function getRequestId(req: AgentServeRequest): number {
  return req._fiberPayRequestId ?? 0;
}

function buildSafeEnv(): Record<string, string> {
  const allowed = [
    'PATH',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENCODE_API_KEY',
    'GEMINI_API_KEY',
  ];
  const env: Record<string, string> = { HOME: '/home/boxlite' };
  for (const key of allowed) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key] as string;
    }
  }
  return env;
}

async function runAcpx(
  agent: string,
  prompt: string,
  options: {
    cwd?: string;
    approveAll?: boolean;
    timeoutSeconds: number;
    boxliteUrl: string;
    boxliteBoxId: string;
    sessionId?: string;
    format?: string;
  },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const client = new BoxliteClient(options.boxliteUrl, options.boxliteBoxId);
  // Some agents (e.g. opencode) do not support global flags like --format or --approve-all.
  const supportsGlobalFlags = !['opencode'].includes(agent);
  const args: string[] = [];

  if (supportsGlobalFlags) {
    args.push('--format', options.format || 'quiet');

    if (options.approveAll) {
      args.push('--approve-all');
    }

    if (options.cwd) {
      args.push('--cwd', '/workspace');
    }

    if (options.timeoutSeconds > 0) {
      args.push('--timeout', String(options.timeoutSeconds));
    }
  }

  args.push(agent);
  if (options.sessionId) {
    args.push('-s', options.sessionId);
  }
  args.push('exec', prompt);

  // Prevent lingering agent processes from breaking ACP initialization for new sessions.
  if (agent === 'opencode') {
    try {
      await client.exec(
        'sh',
        ['-c', 'killall -9 .opencode 2>/dev/null; killall -9 opencode 2>/dev/null; true'],
        { timeout: 5 },
      );
    } catch {}
  }

  const result = await client.exec('acpx', args, {
    env: buildSafeEnv(),
    cwd: '/workspace',
    timeout: options.timeoutSeconds,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exit_code,
  };
}

export async function runAgentServeCommand(
  config: CliConfig,
  options: AgentServeOptions,
): Promise<void> {
  const asJson = Boolean(options.json);
  const port = parseInt(options.port, 10);
  const host = options.host;
  const priceCkb = parseFloat(options.price);
  const expirySeconds = parseInt(options.expiry, 10);
  const timeoutSeconds = parseInt(options.timeout, 10);
  const boxliteUrl = options.boxliteUrl || process.env.BOXLITE_URL || 'http://localhost:8100';
  const boxliteBoxId = options.boxliteBoxId || process.env.BOXLITE_BOX_ID || 'fiber-pay-agent';
  const rootKey = options.rootKey || process.env.L402_ROOT_KEY;

  if (Number.isNaN(port) || port < 0 || port > 65535) {
    if (asJson) {
      printJsonError({
        code: 'AGENT_SERVE_INVALID_PORT',
        message: `Invalid port: ${options.port}`,
        recoverable: true,
        suggestion: 'Provide a valid port number between 1 and 65535.',
      });
    } else {
      console.error(`Error: Invalid port: ${options.port}`);
    }
    process.exit(1);
  }

  if (Number.isNaN(priceCkb) || priceCkb <= 0) {
    if (asJson) {
      printJsonError({
        code: 'AGENT_SERVE_INVALID_PRICE',
        message: `Invalid price: ${options.price}`,
        recoverable: true,
        suggestion: 'Provide a positive CKB amount, e.g. --price 0.1',
      });
    } else {
      console.error(`Error: Invalid price: ${options.price}`);
    }
    process.exit(1);
  }

  if (!rootKey) {
    if (asJson) {
      printJsonError({
        code: 'AGENT_SERVE_MISSING_ROOT_KEY',
        message: 'L402 root key is required.',
        recoverable: true,
        suggestion:
          'Provide --root-key <64-hex-chars> or set L402_ROOT_KEY env var. Generate with: openssl rand -hex 32',
      });
    } else {
      console.error('Error: L402 root key is required.');
      console.error('  Provide --root-key <64-hex-chars> or set L402_ROOT_KEY env var.');
      console.error('  Generate one with: openssl rand -hex 32');
    }
    process.exit(1);
  }

  // Pre-flight: check BoxLite connectivity and acpx availability
  const client = new BoxliteClient(boxliteUrl, boxliteBoxId);
  try {
    const boxExists = await client.checkBoxExists();
    if (!boxExists) {
      const message = `BoxLite box "${boxliteBoxId}" was not found.`;
      if (asJson) {
        printJsonError({
          code: 'AGENT_SERVE_BOXLITE_BOX_NOT_FOUND',
          message,
          recoverable: true,
          suggestion: 'Create the box in BoxLite or check the --boxlite-box-id value.',
        });
      } else {
        console.error(`Error: ${message}`);
        console.error('  Create the box in BoxLite or check the --boxlite-box-id value.');
      }
      process.exit(1);
    }
    await client.exec('acpx', ['--version'], { timeout: 10 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const displayMessage = `BoxLite is unreachable or misconfigured: ${message}`;
    if (asJson) {
      printJsonError({
        code: 'AGENT_SERVE_BOXLITE_ERROR',
        message: displayMessage,
        recoverable: true,
        suggestion: 'Ensure BoxLite is running and the box exists.',
      });
    } else {
      console.error(`Error: ${displayMessage}`);
      console.error('  Ensure BoxLite is running and the box exists.');
    }
    process.exit(1);
  }

  const rpcClient = new FiberRpcClient({
    url: config.rpcUrl,
    biscuitToken: config.rpcBiscuitToken,
  });

  const currency: Currency = config.network === 'mainnet' ? 'Fibb' : 'Fibt';

  const app = express();
  app.use(cors());
  app.use(express.json());

  let requestCounter = 0;

  // Request visibility middleware (works for both challenge and paid flows).
  app.use((req: AgentServeRequest, res, next) => {
    const requestId = ++requestCounter;
    req._fiberPayRequestId = requestId;
    const startTime = Date.now();
    const clientIp = getClientIp(req);

    if (!asJson) {
      console.log(
        `[REQ ${requestId}] ${req.method} ${req.path} from ${clientIp} (auth=${req.headers.authorization ? 'present' : 'none'})`,
      );
    }

    res.on('finish', () => {
      if (asJson) {
        return;
      }

      const durationMs = Date.now() - startTime;
      const l402State = summarizeL402Status(req);

      if (res.statusCode === 402 || res.statusCode === 401) {
        console.log(
          `[REQ ${requestId}] challenge-issued status=${res.statusCode} duration=${durationMs}ms`,
        );
        return;
      }

      console.log(
        `[REQ ${requestId}] completed status=${res.statusCode} duration=${durationMs}ms l402=${l402State}`,
      );
    });

    next();
  });

  // L402 payment gate on all routes
  app.use(
    createL402Middleware({
      rootKey,
      priceCkb,
      expirySeconds,
      rpcClient,
      currency,
    }),
  );

  // Agent endpoint
  app.post('/', async (req: AgentServeRequest, res) => {
    const requestId = getRequestId(req);
    const prompt = req.body?.prompt;
    const sessionId = req.body?.sessionId;
    const requestFormat = typeof req.body?.format === 'string' ? req.body.format : options.format;
    if (!prompt || typeof prompt !== 'string') {
      if (!asJson) {
        console.log(`[REQ ${requestId}] invalid request body: missing string prompt`);
      }
      res.status(400).json({
        error: 'Missing or invalid "prompt" field in request body.',
      });
      return;
    }

    const startTime = Date.now();

    try {
      if (!asJson) {
        console.log(
          `[REQ ${requestId}] payment accepted, invoking agent=${options.agent} promptChars=${prompt.length}${sessionId ? ` session=${sessionId}` : ''}${requestFormat && requestFormat !== 'quiet' ? ` format=${requestFormat}` : ''}`,
        );
      }

      const result = await runAcpx(options.agent, prompt, {
        cwd: options.cwd,
        approveAll: options.approveAll,
        timeoutSeconds,
        boxliteUrl,
        boxliteBoxId,
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
        format: requestFormat,
      });

      const durationMs = Date.now() - startTime;

      if (result.exitCode !== 0) {
        if (!asJson) {
          console.log(
            `[REQ ${requestId}] agent failed exit=${result.exitCode} duration=${durationMs}ms`,
          );
        }

        res.status(502).json({
          error: 'Agent execution failed.',
          agent: options.agent,
          stderr: result.stderr.slice(0, 1000),
          durationMs,
        });
        return;
      }

      if (!asJson) {
        console.log(`[REQ ${requestId}] agent completed duration=${durationMs}ms`);
      }

      let data: unknown;
      if (requestFormat === 'json') {
        try {
          data = result.stdout
            .trim()
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line));
        } catch {}
      }

      res.json({
        response: result.stdout.trim(),
        agent: options.agent,
        durationMs,
        ...(requestFormat && requestFormat !== 'quiet' ? { format: requestFormat } : {}),
        ...(data !== undefined ? { data } : {}),
      });
    } catch (error) {
      if (!asJson) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[REQ ${requestId}] agent execution error: ${message}`);
      }

      if (error instanceof BoxliteError) {
        res.status(502).json({
          error: 'Agent execution failed.',
          agent: options.agent,
          stderr: error.message.slice(0, 1000),
          durationMs: Date.now() - startTime,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error.',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agent: options.agent });
  });

  const server: Server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        if (asJson) {
          printJsonError({
            code: 'AGENT_SERVE_PORT_IN_USE',
            message: `Port ${port} is already in use.`,
            recoverable: true,
            suggestion: 'Use a different port with --port <port>.',
          });
        } else {
          console.error(`Error: Port ${port} is already in use.`);
        }
        process.exit(1);
      }
      reject(err);
    });

    server.listen(port, host, () => {
      resolve();
    });
  });

  const listenUrl = `http://${host}:${port}`;

  if (asJson) {
    printJsonSuccess({
      status: 'running',
      listen: listenUrl,
      agent: options.agent,
      priceCkb,
      expirySeconds,
      currency,
      fiberRpcUrl: config.rpcUrl,
      boxliteUrl,
      boxliteBoxId,
    });
  } else {
    console.log('Agent service started');
    console.log(`  Listen:     ${listenUrl}`);
    console.log(`  Agent:      ${options.agent}`);
    console.log(`  Price:      ${priceCkb} CKB per request`);
    console.log(`  Expiry:     ${expirySeconds}s`);
    console.log(`  Timeout:    ${timeoutSeconds}s per agent call`);
    console.log(`  Currency:   ${currency}`);
    console.log(`  Fiber RPC:  ${config.rpcUrl}`);
    console.log(`  BoxLite:    ${boxliteUrl} (box: ${boxliteBoxId})`);
    console.log('');
    console.log('Endpoint:');
    console.log(`  POST ${listenUrl}/  {"prompt": "your question"}`);
    console.log('');
    console.log('Press Ctrl+C to stop.');
  }

  // Graceful shutdown
  const shutdown = () => {
    if (!asJson) {
      console.log('\nStopping agent service...');
    }
    server.close(() => {
      if (asJson) {
        printJsonSuccess({ status: 'stopped' });
      } else {
        console.log('Agent service stopped.');
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}
