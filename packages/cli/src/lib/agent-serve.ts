/**
 * Agent Serve — L402-gated AI Agent HTTP Service
 *
 * Starts an Express server that:
 * 1. Gates all requests behind L402 payment via createL402Middleware()
 * 2. On paid POST /, spawns `acpx <agent> exec --format quiet '<prompt>'`
 * 3. Returns the agent's response as JSON
 */

import { execFileSync, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { Currency } from '@fiber-pay/sdk';
import { createL402Middleware, FiberRpcClient } from '@fiber-pay/sdk';
import express from 'express';
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
  json?: boolean;
}

function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof forwardedValue === 'string' && forwardedValue.trim().length > 0) {
    return forwardedValue.split(',')[0]?.trim() || 'unknown';
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

function summarizeL402Status(req: express.Request): string {
  const l402 = req as express.Request & {
    l402?: { valid?: boolean; paymentHash?: string; preimage?: string };
  };

  if (l402.l402?.valid) {
    if (l402.l402.paymentHash) {
      return `payment-verified:${l402.l402.paymentHash.slice(0, 14)}...`;
    }
    if (l402.l402.preimage) {
      return 'payment-verified:preimage';
    }
    return 'payment-verified';
  }

  return 'no-l402-token';
}

function getRequestId(req: express.Request): number {
  const withMeta = req as express.Request & { _fiberPayRequestId?: number };
  return withMeta._fiberPayRequestId ?? 0;
}

function runAcpx(
  agent: string,
  prompt: string,
  options: { cwd?: string; approveAll?: boolean; timeoutSeconds: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const args = ['--format', 'quiet'];

    if (options.approveAll) {
      args.push('--approve-all');
    }

    if (options.cwd) {
      args.push('--cwd', options.cwd);
    }

    if (options.timeoutSeconds > 0) {
      args.push('--timeout', String(options.timeoutSeconds));
    }

    args.push(agent, 'exec', prompt);

    const child = spawn('acpx', args, {
      cwd: options.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Force kill after timeout + 30s grace
    const killTimer = setTimeout(
      () => {
        child.kill('SIGKILL');
      },
      (options.timeoutSeconds + 30) * 1000,
    );

    child.on('close', (code) => {
      clearTimeout(killTimer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on('error', (err) => {
      clearTimeout(killTimer);
      resolve({ stdout: '', stderr: err.message, exitCode: 1 });
    });
  });
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
  const rootKey = options.rootKey || process.env.L402_ROOT_KEY;

  if (Number.isNaN(port) || port < 1 || port > 65535) {
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

  // Pre-flight: check acpx is installed
  try {
    execFileSync('acpx', ['--version'], { stdio: 'ignore' });
  } catch {
    if (asJson) {
      printJsonError({
        code: 'AGENT_SERVE_ACPX_NOT_FOUND',
        message: 'acpx is not installed or not in PATH.',
        recoverable: true,
        suggestion: 'Install acpx globally: npm install -g acpx',
      });
    } else {
      console.error('Error: acpx is not installed or not in PATH.');
      console.error('  Install it with: npm install -g acpx');
      console.error('  See: https://github.com/openclaw/acpx');
    }
    process.exit(1);
  }

  const rpcClient = new FiberRpcClient({
    url: config.rpcUrl,
    biscuitToken: config.rpcBiscuitToken,
  });

  const currency: Currency = config.network === 'mainnet' ? 'Fibb' : 'Fibt';

  const app = express();
  app.use(express.json());

  let requestCounter = 0;

  // Request visibility middleware (works for both challenge and paid flows).
  app.use((req, res, next) => {
    const requestId = ++requestCounter;
    (req as express.Request & { _fiberPayRequestId?: number })._fiberPayRequestId = requestId;
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
  app.post('/', async (req, res) => {
    const requestId = getRequestId(req);
    const prompt = req.body?.prompt;
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
          `[REQ ${requestId}] payment accepted, invoking agent=${options.agent} promptChars=${prompt.length}`,
        );
      }

      const result = await runAcpx(options.agent, prompt, {
        cwd: options.cwd,
        approveAll: options.approveAll,
        timeoutSeconds,
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

      res.json({
        response: result.stdout.trim(),
        agent: options.agent,
        durationMs,
      });
    } catch (error) {
      if (!asJson) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[REQ ${requestId}] agent execution error: ${message}`);
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
