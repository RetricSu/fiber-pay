import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const IS_WINDOWS = process.platform === 'win32';
const FIBER_PAY_BIN = process.env.FIBER_PAY_BIN || (IS_WINDOWS ? 'fiber-pay.cmd' : 'fiber-pay');

/**
 * Resolve the actual .js CLI entrypoint for direct node invocation.
 * This avoids .cmd shim indirection on Windows where shell:true + detached:true
 * causes file descriptor inheritance to break across the cmd.exe → batch → node chain.
 */
function resolveCliEntrypoint() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const cliJs = join(__dirname, '..', 'packages', 'cli', 'dist', 'cli.js');
  if (!existsSync(cliJs)) {
    throw new Error(`CLI entrypoint not found at ${cliJs}. Was the CLI built?`);
  }
  return cliJs;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPathWithinParent(pathToCheck, parentPath) {
  const rel = relative(parentPath, pathToCheck);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function lastJsonLine(text) {
  const trimmed = text.trim();
  if (trimmed.length > 0) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to line scan
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // continue scanning
    }
  }

  return null;
}

async function runFiberPay(args, { timeoutMs = 120_000, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    // On Windows, .cmd files require shell mode for spawn to work
    const useShell = IS_WINDOWS && /\.cmd$/i.test(FIBER_PAY_BIN);

    const child = spawn(FIBER_PAY_BIN, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const result = {
        code: code ?? -1,
        stdout,
        stderr,
        json: lastJsonLine(stdout),
      };

      if (!allowFailure && result.code !== 0) {
        const error = new Error(
          `fiber-pay ${args.join(' ')} failed with code ${result.code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
        reject(error);
        return;
      }

      resolve(result);
    });
  });
}

async function waitForNodeRunning(maxAttempts = 60) {
  let lastResult;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runFiberPay(['node', 'status', '--json'], { allowFailure: true });
    lastResult = result;

    if (result.code === 0 && result.json?.success === true && result.json?.data?.running === true) {
      return result.json.data;
    }

    await delay(1000);
  }

  throw new Error(
    `Node did not report running status in time. Last stdout:\n${lastResult?.stdout ?? ''}\nLast stderr:\n${lastResult?.stderr ?? ''}`,
  );
}

async function waitForRuntimeRunning(maxAttempts = 30) {
  let lastResult;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runFiberPay(['runtime', 'status', '--json'], { allowFailure: true });
    lastResult = result;

    if (result.code === 0 && result.json?.success === true && result.json?.data?.running === true) {
      return result.json.data;
    }

    await delay(1000);
  }

  throw new Error(
    `Runtime did not report running status in time. Last stdout:\n${lastResult?.stdout ?? ''}\nLast stderr:\n${lastResult?.stderr ?? ''}`,
  );
}

function assertJsonSuccess(result, label) {
  if (!result.json || result.json.success !== true) {
    throw new Error(`${label} did not return a successful JSON payload. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.json.data;
}

function assertFnnLogEntry(logData, source) {
  const entries = Array.isArray(logData?.entries) ? logData.entries : [];
  const entry = entries.find((item) => item?.source === source);
  if (!entry) {
    throw new Error(`Missing log entry for source '${source}'.`);
  }
  if (typeof entry.path !== 'string' || !entry.path.includes('logs')) {
    throw new Error(`Expected a persisted log path for '${source}'. Got: ${entry.path}`);
  }
}

function assertKeyState(baseDir, expected) {
  const fiberKeyPath = join(baseDir, 'fiber', 'sk');
  const ckbKeyPath = join(baseDir, 'ckb', 'key');

  const fiberExists = existsSync(fiberKeyPath);
  const ckbExists = existsSync(ckbKeyPath);

  if (expected === 'absent') {
    if (fiberExists || ckbExists) {
      throw new Error(
        `Expected fresh run without keys, but found existing key files. fiber=${fiberExists} ckb=${ckbExists}`,
      );
    }
    return;
  }

  if (!fiberExists || !ckbExists) {
    throw new Error(
      `Expected generated key files after startup. fiber=${fiberExists} ckb=${ckbExists}`,
    );
  }

  const fiberKey = readFileSync(fiberKeyPath);
  const ckbKey = readFileSync(ckbKeyPath, 'utf8').trim();

  if (fiberKey.length !== 32) {
    throw new Error(`Invalid fiber key length: expected 32 bytes, got ${fiberKey.length}`);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(ckbKey)) {
    throw new Error('Invalid ckb key format: expected 64-char hex private key');
  }
}

async function waitForGeneratedKeys(baseDir, maxAttempts = 60) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      assertKeyState(baseDir, 'present');
      return;
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  throw new Error(
    `Key files were not generated in time: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Start the fiber-pay node as a background process.
 *
 * On Unix, we use the CLI's built-in --daemon flag which spawns a detached
 * child internally. On Windows, the CLI's daemon mode silently fails because
 * the re-spawned child process crashes (stdio:'ignore' + detached on Windows).
 *
 * Additionally, spawning .cmd shims with shell:true + detached:true + FD stdio
 * does not work: the cmd.exe → batch → node.exe chain causes CRT file
 * descriptors to not survive the double-hop, resulting in empty log files and
 * invisible background processes.
 *
 * The fix: on Windows, resolve the .js CLI entrypoint directly and spawn
 * node.exe with it — no shell, no .cmd. This gives proper FD inheritance,
 * correct PID for cleanup, and the child runs the CLI code directly.
 */
async function startNodeBackground(baseDir) {
  if (!IS_WINDOWS) {
    const start = await runFiberPay(['node', 'start', '--daemon', '--json', '--quiet-fnn']);
    if (!(start.json?.success === true || start.json?.event === 'node_daemon_starting')) {
      throw new Error(
        `node start did not return an expected daemon JSON payload. stdout:\n${start.stdout}\nstderr:\n${start.stderr}`,
      );
    }
    return null; // no child handle needed; daemon is self-managed
  }

  // Windows: spawn node.exe directly with the CLI .js entrypoint.
  // No shell:true, no .cmd shim — this ensures FD inheritance works and
  // the PID we get is the actual node process (not cmd.exe).
  const cliEntrypoint = resolveCliEntrypoint();
  const logsDir = join(baseDir, 'logs');
  mkdirSync(logsDir, { recursive: true });

  const { openSync } = await import('node:fs');
  const outFd = openSync(join(logsDir, 'smoke-bg-stdout.log'), 'a');
  const errFd = openSync(join(logsDir, 'smoke-bg-stderr.log'), 'a');

  const child = spawn(process.execPath, [cliEntrypoint, 'node', 'start', '--json', '--quiet-fnn'], {
    env: process.env,
    stdio: ['ignore', outFd, errFd],
    detached: true,
  });
  child.unref();

  if (!child.pid) {
    throw new Error('Failed to spawn background node process on Windows');
  }
  console.log(`[smoke] Windows: spawned node.exe ${cliEntrypoint} in background (PID: ${child.pid})`);
  return child;
}

async function main() {
  const runTag = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const expectedParent = process.env.RUNNER_TEMP || tmpdir();
  const baseDirInput =
    process.env.FIBER_DATA_DIR ||
    join(expectedParent, `fiber-pay-ci-smoke-${process.platform}-${runTag}`);

  const baseDir = resolve(baseDirInput);
  const expectedParentResolved = resolve(expectedParent);
  if (!isPathWithinParent(baseDir, expectedParentResolved)) {
    throw new Error(
      `[smoke] invalid FIBER_DATA_DIR: ${baseDir}. Path must be within ${expectedParentResolved}`,
    );
  }

  process.env.FIBER_DATA_DIR = baseDir;
  mkdirSync(baseDir, { recursive: true });

  console.log(`[smoke] using FIBER_DATA_DIR=${baseDir}`);

  let nodeStarted = false;
  let bgChild = null;
  try {
    assertKeyState(baseDir, 'absent');

    bgChild = await startNodeBackground(baseDir);
    nodeStarted = true;

    await waitForGeneratedKeys(baseDir);

    const nodeStatus = await waitForNodeRunning();
    console.log(`[smoke] node running: pid=${nodeStatus.pid ?? 'n/a'} rpcResponsive=${nodeStatus.rpcResponsive}`);

    // On Windows, the foreground node-start (no --daemon) starts the runtime
    // service embedded in-process, so we just wait for it to appear.
    // On Unix, the daemon child sets FIBER_NODE_RUNTIME_DAEMON=1 which
    // launches a separate runtime daemon. If that hasn't come up yet, we
    // attempt an explicit `runtime start --daemon` as fallback.
    if (!IS_WINDOWS) {
      const runtimeStatus = await runFiberPay(['runtime', 'status', '--json'], { allowFailure: true });
      if (!(runtimeStatus.code === 0 && runtimeStatus.json?.success === true && runtimeStatus.json?.data?.running === true)) {
        const runtimeStart = await runFiberPay(['runtime', 'start', '--daemon', '--json'], {
          allowFailure: true,
        });
        const alreadyRunning = runtimeStart.json?.error?.code === 'RUNTIME_ALREADY_RUNNING';
        if (
          runtimeStart.code !== 0 &&
          !alreadyRunning &&
          !(runtimeStart.json?.success === true || runtimeStart.json?.event === 'runtime_starting')
        ) {
          throw new Error(
            `runtime start did not return an expected daemon JSON payload. stdout:\n${runtimeStart.stdout}\nstderr:\n${runtimeStart.stderr}`,
          );
        }
      }
    }
    await waitForRuntimeRunning();

    const allLogs = await runFiberPay(['logs', '--source', 'all', '--tail', '20', '--json']);
    const allLogData = assertJsonSuccess(allLogs, 'logs all sources');
    assertFnnLogEntry(allLogData, 'fnn-stdout');
    assertFnnLogEntry(allLogData, 'fnn-stderr');

    console.log('[smoke] node/runtime start + fnn logs verification passed');
  } finally {
    if (nodeStarted) {
      await runFiberPay(['node', 'stop', '--json'], { allowFailure: true });
      await delay(1000);
    }

    await runFiberPay(['runtime', 'stop', '--json'], { allowFailure: true });

    // On Windows, also kill the background child we spawned directly
    if (bgChild && bgChild.pid) {
      try {
        process.kill(bgChild.pid);
      } catch {
        // already exited
      }
    }

    if (process.env.CI !== 'true') {
      rmSync(baseDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(`[smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
