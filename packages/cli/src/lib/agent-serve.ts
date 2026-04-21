/**
 * Agent Serve — L402-gated AI Agent HTTP Service
 *
 * Starts an Express server that:
 * 1. Gates all requests behind L402 payment via createL402Middleware()
 * 2. On paid POST /, runs `acpx <agent> exec --format quiet '<prompt>'` inside a BoxLite sandbox
 * 3. Returns either JSON (default) or SSE stream (`stream: "sse"` or Accept header)
 *
 * ## Per-session namespace isolation
 *
 * Each request is wrapped with `unshare --user --pid --mount` (Linux namespaces) so that
 * the agent process gets a private view of the filesystem and cannot enumerate or access
 * other sessions' workspaces or processes:
 *
 *   - `/workspace` is bind-mounted to `/workspace/sessions/<sessionId>/` inside the namespace
 *   - `/tmp` is bind-mounted to `/tmp/fiber-sessions/<sessionId>/` inside the namespace
 *   - PID namespace: agent cannot see other sessions' processes via `ps` or `/proc`
 *   - User namespace: virtual root inside the namespace (no real privilege escalation)
 *
 * Isolation is probed at startup. If the kernel does not support unprivileged user
 * namespaces the server falls back to directory-only isolation and logs a warning.
 * Use `--no-isolation` to skip the probe entirely (development/debug only).
 *
 * Run `scripts/boxlite-setup.sh` inside the BoxLite Alpine container once to install
 * `util-linux` (full-featured `unshare`) and create the required base directories.
 */

import { randomUUID } from 'node:crypto';
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
  /** Skip Linux namespace isolation even if the kernel supports it (useful for debugging). */
  noIsolation?: boolean;
  /** How long (in hours) to keep a named session workspace before auto-cleanup. */
  workspaceTtlHours?: string;
  /** Minimum free space (in MB) required on /workspace before accepting a new session. */
  workspaceMinFreeMb?: string;
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

function shouldUseSse(req: AgentServeRequest): boolean {
  const streamMode = req.body?.stream;
  if (streamMode === true || streamMode === 'sse') {
    return true;
  }

  const acceptHeader = req.headers.accept;
  if (typeof acceptHeader !== 'string') {
    return false;
  }

  return acceptHeader.includes('text/event-stream');
}

function parseJsonLines(text: string): Array<Record<string, unknown>> | undefined {
  try {
    return text
      .trim()
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return undefined;
  }
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

// ---------------------------------------------------------------------------
// Linux namespace isolation helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize an arbitrary session ID string into a safe filesystem path component.
 * Replaces any character that is not alphanumeric, hyphen, or underscore with
 * a hyphen, then truncates to 64 characters.
 */
function sanitizeSessionId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9\-_]/g, '-').slice(0, 64);
}

/**
 * Single-quote a string for safe embedding in a POSIX sh -c script.
 * Handles embedded single-quotes via the '\'' escape sequence.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}' `;
}

/**
 * Check available disk space on /workspace inside the BoxLite container.
 * Returns available bytes and usage percentage, or null if the check fails.
 */
async function checkDiskSpace(
  client: BoxliteClient,
): Promise<{ availableBytes: number; usedPercent: number } | null> {
  try {
    const result = await client.exec(
      'sh',
      ['-c', "df -P /workspace | awk 'NR==2 {print $4, $5}'"],
      { timeout: 5 },
    );
    if (result.exit_code !== 0) return null;
    const [availStr, usedStr] = result.stdout.trim().split(/\s+/);
    const availableBytes = parseInt(availStr, 10) * 1024; // df outputs 1K blocks
    const usedPercent = parseInt(usedStr.replace('%', ''), 10);
    if (Number.isNaN(availableBytes) || Number.isNaN(usedPercent)) return null;
    return { availableBytes, usedPercent };
  } catch {
    return null;
  }
}

/**
 * Clean up stale session workspaces based on mtime.
 * Runs inside the BoxLite container so it has access to the actual paths.
 */
async function cleanupStaleWorkspaces(client: BoxliteClient, ttlHours: number): Promise<void> {
  try {
    await client.exec(
      'sh',
      [
        '-c',
        `find /workspace/sessions /tmp/fiber-sessions -mindepth 1 -maxdepth 1 -type d -mtime +${Math.floor(ttlHours)} -exec rm -rf {} + 2>/dev/null || true`,
      ],
      { timeout: 60 },
    );
  } catch {
    // Best-effort cleanup; do not crash the server.
  }
}

/**
 * Build the argument list for `unshare` that wraps a command with per-session
 * Linux namespace isolation:
 *
 *   - user namespace  → virtual root (no real privilege escalation)
 *   - PID namespace   → agent cannot enumerate other sessions' processes
 *   - mount namespace → /workspace and /tmp are private bind-mounts
 *   - --mount-proc    → /proc reflects only the session's PID namespace
 *
 * The session directory is created lazily inside the sh script so that the
 * first request for a session initialises its workspace automatically.
 */
function buildIsolationWrapArgs(
  command: string,
  args: string[],
  sessionDir: string,
  sessionTmpDir: string,
): string[] {
  const quotedCmd = [command, ...args].map(shellQuote).join(' ');
  // Steps executed inside the new namespaces:
  //   1. mkdir -p  — create session dirs if they do not yet exist
  //   2. mount --bind — redirect /workspace to the session-specific dir
  //   3. cd /workspace — re-anchor cwd to the bind-mounted path
  //   4. mount --bind — redirect /tmp to the session-specific tmp dir
  //   5. exec — replace sh with the actual agent command (zero overhead)
  const script = [
    // In a user namespace the shell may reset HOME to /root (via getpwuid).
    // Force it back to /home/boxlite so acpx finds sessions in the same
    // directory that "sessions ensure" used outside the namespace.
    `export HOME=${shellQuote('/home/boxlite')}`,
    `mkdir -p ${shellQuote(sessionDir)}`,
    `mkdir -p ${shellQuote(sessionTmpDir)}`,
    // acpx searches for sessions from cwd upward (looking for .acpx/).
    // Bind-mount the shared acpx state directly onto /workspace/.acpx so
    // the agent can find its session after /workspace is rebound.
    `mount --bind ${shellQuote(sessionDir)} /workspace`,
    `cd /workspace`,
    `mount --bind /home/boxlite/.acpx /workspace/.acpx 2>/dev/null || true`,
    `mount --bind ${shellQuote(sessionTmpDir)} /tmp`,
    `exec ${quotedCmd}`,
  ].join(' && ');

  return [
    '--user',
    '--pid',
    '--mount',
    '--fork',
    '--map-root-user',
    '--mount-proc',
    'sh',
    '-c',
    script,
  ];
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
    signal?: AbortSignal;
    onChunk?: (chunk: { type: 'stdout' | 'stderr'; text: string }) => void;
    /** Whether the BoxLite box supports Linux namespace isolation. */
    isolationAvailable?: boolean;
    /** Override to skip isolation for this call (e.g. --no-isolation flag). */
    noIsolation?: boolean;
  },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const client = new BoxliteClient(options.boxliteUrl, options.boxliteBoxId);
  const supportsGlobalFlags = !['opencode'].includes(agent);
  const useIsolation = Boolean(options.isolationAvailable) && !options.noIsolation;

  // Compute stable session paths.
  // Named sessions: deterministic path so successive requests share the same workspace.
  // Anonymous (no sessionId): random UUID path, cleaned up after the request.
  const safeId = options.sessionId ? sanitizeSessionId(options.sessionId) : `anon-${randomUUID()}`;
  const sessionDir = `/workspace/sessions/${safeId}`;
  const sessionTmpDir = `/tmp/fiber-sessions/${safeId}`;

  async function execPrompt(): Promise<{ stdout: string; stderr: string; exit_code: number }> {
    const acpxArgs: string[] = [];
    if (supportsGlobalFlags) {
      acpxArgs.push('--format', options.format || 'quiet');
      if (options.approveAll) acpxArgs.push('--approve-all');
      if (options.cwd) acpxArgs.push('--cwd', '/workspace');
      if (options.timeoutSeconds > 0) acpxArgs.push('--timeout', String(options.timeoutSeconds));
    }
    if (options.sessionId) {
      acpxArgs.push(agent, '-s', options.sessionId, prompt);
    } else {
      acpxArgs.push(agent, 'exec', prompt);
    }

    // When isolation is available, wrap acpx inside `unshare` so that the
    // agent process gets its own PID and mount namespaces.  Inside those
    // namespaces the sh init script bind-mounts the per-session directory
    // over /workspace and a per-session tmpdir over /tmp before exec-ing
    // acpx, giving each session a completely private filesystem view.
    const execCommand = useIsolation ? 'unshare' : 'acpx';
    const execArgs = useIsolation
      ? buildIsolationWrapArgs('acpx', acpxArgs, sessionDir, sessionTmpDir)
      : acpxArgs;

    const execOptions = {
      env: buildSafeEnv(),
      timeout: options.timeoutSeconds,
      signal: options.signal,
    };

    if (!options.onChunk) {
      return client.exec(execCommand, execArgs, execOptions);
    }

    let stdout = '';
    let stderr = '';
    let exitCode: number | undefined;

    for await (const chunk of client.execStream(execCommand, execArgs, execOptions)) {
      if (chunk.stdout.length > 0) {
        stdout += chunk.stdout;
        options.onChunk({ type: 'stdout', text: chunk.stdout });
      }

      if (chunk.stderr.length > 0) {
        stderr += chunk.stderr;
        options.onChunk({ type: 'stderr', text: chunk.stderr });
      }

      if (chunk.exit_code !== undefined) {
        exitCode = chunk.exit_code;
      }
    }

    if (exitCode === undefined) {
      throw new BoxliteError('EXEC_FAILED', 'BoxLite exec returned without exit code');
    }

    return {
      stdout,
      stderr,
      exit_code: exitCode,
    };
  }

  async function closeSession(): Promise<void> {
    if (!options.sessionId || options.sessionId.startsWith('__')) return;
    try {
      await client.exec(
        'sh',
        [
          '-c',
          `cd /workspace && acpx ${shellQuote(agent)} sessions close ${shellQuote(options.sessionId)}`,
        ],
        {
          env: buildSafeEnv(),
          timeout: 10,
        },
      );
    } catch {}
    // Clean up the isolated session workspace so that a re-opened session
    // starts with a fresh directory rather than stale state.
    // Only run when isolation was actually used — without isolation there is
    // no per-session directory to remove.
    if (useIsolation) {
      client
        .exec('sh', ['-c', `rm -rf ${shellQuote(sessionDir)} ${shellQuote(sessionTmpDir)}`], {
          timeout: 10,
        })
        .catch(() => {});
    }
  }

  if (options.sessionId) {
    try {
      await client.exec(
        'sh',
        [
          '-c',
          `cd /workspace && acpx ${shellQuote(agent)} sessions ensure --name ${shellQuote(options.sessionId)}`,
        ],
        {
          env: buildSafeEnv(),
          timeout: 10,
        },
      );
    } catch (err) {
      await closeSession();
      throw err;
    }

    let result: { stdout: string; stderr: string; exit_code: number };
    try {
      result = await execPrompt();
    } catch (err) {
      await closeSession();
      throw err;
    }

    if (result.exit_code !== 0 && !options.sessionId.startsWith('__')) {
      await closeSession();
      try {
        await client.exec(
          'sh',
          [
            '-c',
            `cd /workspace && acpx ${shellQuote(agent)} sessions ensure --name ${shellQuote(options.sessionId)}`,
          ],
          {
            env: buildSafeEnv(),
            timeout: 10,
          },
        );
      } catch (ensureErr) {
        await closeSession();
        throw ensureErr;
      }
      try {
        result = await execPrompt();
      } catch (err) {
        await closeSession();
        throw err;
      }
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exit_code,
    };
  }

  // Anonymous one-shot request: clean up the workspace after exec completes.
  const result = await execPrompt();
  if (useIsolation) {
    client
      .exec('sh', ['-c', `rm -rf ${shellQuote(sessionDir)} ${shellQuote(sessionTmpDir)}`], {
        timeout: 10,
      })
      .catch(() => {});
  }
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

  // TODO: BoxLite only supports an allowNet whitelist, which is either too
  // permissive or too restrictive for production agents that need to browse.
  // A better long-term approach is to run a small host-side HTTP proxy that
  // supports a denyList (e.g. localhost / 127.0.0.1 / RFC-1918 IPs) and let
  // the Box route all outbound traffic through it. This gives us blacklist
  // semantics for security while keeping the agent free to search and fetch.
  //
  // The same proxy can also act as an API-key shim: the Box talks to a
  // host-local pseudo-provider endpoint (e.g. http://host:8101/v1/chat) so
  // the real ANTHROPIC_API_KEY never enters the sandbox at all. This removes
  // the prompt-injection key-exfiltration vector entirely.
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

  // When isolation is requested, prepare the directory structure and probe
  // whether the kernel supports unprivileged user namespaces.
  let isolationAvailable = false;
  const workspaceMinFreeMb = parseInt(options.workspaceMinFreeMb || '100', 10);
  const workspaceTtlHours = parseInt(options.workspaceTtlHours || '24', 10);
  if (!options.noIsolation) {
    // Ensure the base session directories exist (non-fatal; the isolation
    // script also creates them lazily, but pre-creating avoids a race on
    // the very first request).
    try {
      await client.exec('sh', ['-c', 'mkdir -p /workspace/sessions /tmp/fiber-sessions'], {
        timeout: 5,
      });
    } catch {
      // Non-fatal: the namespace init script will retry inside unshare.
    }

    // Probe whether the kernel allows unprivileged user namespaces.
    try {
      await client.exec(
        'unshare',
        [
          '--user',
          '--pid',
          '--mount',
          '--fork',
          '--map-root-user',
          '--mount-proc',
          'sh',
          '-c',
          'echo isolation-probe-ok',
        ],
        { timeout: 10 },
      );
      isolationAvailable = true;
    } catch {
      // Kernel does not allow unprivileged namespaces; fall back to
      // directory-only isolation.  Run `scripts/boxlite-setup.sh` inside
      // the box and check kernel.unprivileged_userns_clone on the host.
      isolationAvailable = false;
    }

    // Disk-space guard: probe /workspace availability at startup.
    const disk = await checkDiskSpace(client);
    if (disk) {
      const availableMb = Math.floor(disk.availableBytes / (1024 * 1024));
      if (disk.usedPercent >= 95) {
        const message = `Workspace disk is critically full (${disk.usedPercent}% used, ${availableMb} MB free).`;
        if (asJson) {
          printJsonError({
            code: 'AGENT_SERVE_DISK_FULL',
            message,
            recoverable: true,
            suggestion: 'Free up disk space on the BoxLite host or increase container storage.',
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }
      if (disk.usedPercent >= 90) {
        console.warn(
          `Warning: Workspace disk is nearly full (${disk.usedPercent}% used, ${availableMb} MB free).`,
        );
      }
      if (availableMb < workspaceMinFreeMb) {
        console.warn(
          `Warning: Workspace free space (${availableMb} MB) is below --workspace-min-free-mb (${workspaceMinFreeMb} MB). New sessions may be rejected.`,
        );
      }
    }
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

  // Scheduled workspace cleanup with adaptive TTL.
  let cleanupIntervalMs = 60 * 60 * 1000; // 1 hour
  const cleanupTimer = setInterval(async () => {
    const d = await checkDiskSpace(client);
    const pressure = d
      ? d.usedPercent >= 90 || d.availableBytes < workspaceMinFreeMb * 1024 * 1024
      : false;
    const ttl = pressure ? Math.min(1, workspaceTtlHours) : workspaceTtlHours;
    if (pressure && cleanupIntervalMs > 10 * 60 * 1000) {
      cleanupIntervalMs = 10 * 60 * 1000; // speed up to 10 min under pressure
      clearInterval(cleanupTimer);
      // restart with shorter interval (handled by outer scope, just clear here)
    }
    await cleanupStaleWorkspaces(client, ttl);
  }, cleanupIntervalMs);

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
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId : undefined;
    const useSse = shouldUseSse(req);

    try {
      if (!asJson) {
        console.log(
          `[REQ ${requestId}] payment accepted, invoking agent=${options.agent} promptChars=${prompt.length}${sessionId ? ` session=${sessionId}` : ''}${requestFormat && requestFormat !== 'quiet' ? ` format=${requestFormat}` : ''}${useSse ? ' stream=sse' : ''}`,
        );
      }

      if (useSse) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        let streamClosed = false;
        let clientClosed = false;
        const abortController = new AbortController();

        const heartbeat = setInterval(() => {
          if (!streamClosed && !res.writableEnded) {
            res.write(': keep-alive\n\n');
          }
        }, 15000);

        const closeStream = () => {
          if (streamClosed) {
            return;
          }
          streamClosed = true;
          clearInterval(heartbeat);
          if (!res.writableEnded) {
            res.end();
          }
        };

        const sendSse = (event: string, data: unknown) => {
          if (streamClosed || res.writableEnded) {
            return;
          }
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        const handleDisconnect = () => {
          if (streamClosed) {
            return;
          }
          clientClosed = true;
          abortController.abort();
        };

        req.on('aborted', handleDisconnect);
        res.on('close', handleDisconnect);

        const result = await runAcpx(options.agent, prompt, {
          cwd: options.cwd,
          approveAll: options.approveAll,
          timeoutSeconds,
          boxliteUrl,
          boxliteBoxId,
          sessionId: normalizedSessionId,
          format: requestFormat,
          signal: abortController.signal,
          isolationAvailable,
          noIsolation: options.noIsolation,
          onChunk: (chunk) => {
            sendSse('chunk', chunk);
          },
        });

        if (clientClosed) {
          closeStream();
          return;
        }

        const durationMs = Date.now() - startTime;

        if (result.exitCode !== 0) {
          if (!asJson) {
            console.log(
              `[REQ ${requestId}] agent failed exit=${result.exitCode} duration=${durationMs}ms`,
            );
          }

          sendSse('error', {
            code: 'EXEC_FAILED',
            message: result.stderr.slice(0, 1000) || 'Agent execution failed.',
            agent: options.agent,
            durationMs,
          });
          closeStream();
          return;
        }

        if (!asJson) {
          console.log(`[REQ ${requestId}] agent completed duration=${durationMs}ms`);
        }

        sendSse('done', {
          durationMs,
          agent: options.agent,
          ...(requestFormat && requestFormat !== 'quiet' ? { format: requestFormat } : {}),
        });
        closeStream();
        return;
      }

      const result = await runAcpx(options.agent, prompt, {
        cwd: options.cwd,
        approveAll: options.approveAll,
        timeoutSeconds,
        boxliteUrl,
        boxliteBoxId,
        sessionId: normalizedSessionId,
        format: requestFormat,
        isolationAvailable,
        noIsolation: options.noIsolation,
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

      const data = requestFormat === 'json' ? parseJsonLines(result.stdout) : undefined;

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

      if (typeof normalizedSessionId === 'string' && !normalizedSessionId.startsWith('__')) {
        try {
          const cleanupClient = new BoxliteClient(boxliteUrl, boxliteBoxId);
          await cleanupClient.exec(
            'sh',
            [
              '-c',
              `cd /workspace && acpx ${shellQuote(options.agent)} sessions close ${shellQuote(normalizedSessionId)}`,
            ],
            {
              env: buildSafeEnv(),
              timeout: 10,
            },
          );
        } catch {}
      }

      if (useSse) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders();
        }

        if (!res.writableEnded) {
          if (error instanceof BoxliteError) {
            res.write('event: error\n');
            res.write(
              `data: ${JSON.stringify({
                code: error.code,
                message: error.message.slice(0, 1000),
                agent: options.agent,
                durationMs: Date.now() - startTime,
              })}\n\n`,
            );
          } else {
            res.write('event: error\n');
            res.write(
              `data: ${JSON.stringify({
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : String(error),
                agent: options.agent,
                durationMs: Date.now() - startTime,
              })}\n\n`,
            );
          }

          res.end();
        }
        return;
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
    const isolationLabel = options.noIsolation
      ? 'disabled (--no-isolation)'
      : isolationAvailable
        ? 'namespace (PID + mount + user)'
        : 'directory-only (unshare unavailable)';
    console.log('Agent service started');
    console.log(`  Listen:     ${listenUrl}`);
    console.log(`  Agent:      ${options.agent}`);
    console.log(`  Price:      ${priceCkb} CKB per request`);
    console.log(`  Expiry:     ${expirySeconds}s`);
    console.log(`  Timeout:    ${timeoutSeconds}s per agent call`);
    console.log(`  Currency:   ${currency}`);
    console.log(`  Fiber RPC:  ${config.rpcUrl}`);
    console.log(`  BoxLite:    ${boxliteUrl} (box: ${boxliteBoxId})`);
    console.log(`  Isolation:  ${isolationLabel}`);
    console.log('');
    console.log('Endpoint:');
    console.log(`  POST ${listenUrl}/  {"prompt": "your question"}`);
    console.log('');
    console.log('Press Ctrl+C to stop.');
  }

  // Graceful shutdown
  const shutdown = () => {
    clearInterval(cleanupTimer);
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
