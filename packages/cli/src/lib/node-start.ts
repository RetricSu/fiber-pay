import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createKeyManager,
  ensureFiberBinary,
  type FiberNodeConfig,
  getDefaultBinaryPath,
  ProcessManager,
} from '@fiber-pay/node';
import { startRuntimeService } from '@fiber-pay/runtime';
import { autoConnectBootnodes, extractBootnodeAddrs } from './bootnode.js';
import { type CliConfig, ensureNodeConfigFile } from './config.js';
import { printJsonError, printJsonEvent } from './format.js';
import { appendToTodayLog, resolveLogDirForDate } from './log-files.js';
import { runMigrationGuard } from './node-migration.js';
import {
  getBinaryVersion,
  startRuntimeDaemonFromNode,
  stopRuntimeDaemonFromNode,
} from './node-runtime-daemon.js';
import { isProcessRunning, readPidFile, removePidFile, writePidFile } from './pid.js';
import { createRpcClient } from './rpc.js';
import { removeRuntimeFiles, writeRuntimeMeta, writeRuntimePid } from './runtime-meta.js';

export interface NodeStartOptions {
  daemon?: boolean;
  runtimeProxyListen?: string;
  eventStream?: string;
  quietFnn?: boolean;
  json?: boolean;
}

export async function runNodeStartCommand(
  config: CliConfig,
  options: NodeStartOptions,
): Promise<void> {
  const json = Boolean(options.json);
  const daemon = Boolean(options.daemon);
  const isNodeChild = process.env.FIBER_NODE_CHILD === '1';
  const quietFnn = Boolean(options.quietFnn);
  const eventStream = String(options.eventStream ?? 'jsonl').toLowerCase();
  const emitStage = (stage: string, status: 'ok' | 'error', data: Record<string, unknown>) => {
    if (!json) return;
    printJsonEvent('startup_stage', { stage, status, ...data });
  };
  const emitFnnLog = (stream: 'stdout' | 'stderr', text: string) => {
    if (quietFnn) {
      return;
    }

    if (json) {
      printJsonEvent('fnn_log', { stream, text });
      return;
    }

    const target = stream === 'stderr' ? process.stderr : process.stdout;
    const payload = text.endsWith('\n') ? text : `${text}\n`;
    target.write(`[fnn:${stream}] ${payload}`);
  };
  if (json && eventStream !== 'jsonl') {
    printJsonError({
      code: 'NODE_EVENT_STREAM_INVALID',
      message: `Unsupported --event-stream format: ${options.eventStream}. Expected: jsonl`,
      recoverable: true,
      suggestion: 'Use `--event-stream jsonl` when using --json.',
      details: { provided: options.eventStream, expected: ['jsonl'] },
    });
    process.exit(1);
  }

  if (daemon && !isNodeChild) {
    const cliEntrypoint = process.argv[1];
    if (!cliEntrypoint) {
      const message = 'Unable to resolve CLI entrypoint path for --daemon mode';
      if (json) {
        printJsonError({
          code: 'NODE_DAEMON_START_FAILED',
          message,
          recoverable: true,
          suggestion: 'Retry without --daemon or check CLI invocation method.',
        });
      } else {
        console.error(`❌ ${message}`);
      }
      process.exit(1);
    }

    const childArgs = process.argv.slice(2).filter((arg) => arg !== '--daemon');
    const child = spawn(process.execPath, [cliEntrypoint, ...childArgs], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
      env: {
        ...process.env,
        FIBER_NODE_CHILD: '1',
        FIBER_NODE_RUNTIME_DAEMON: '1',
      },
    });
    child.unref();

    const childPid = child.pid;
    if (!childPid) {
      const message = 'Failed to spawn node daemon process';
      if (json) {
        printJsonError({
          code: 'NODE_DAEMON_START_FAILED',
          message,
          recoverable: true,
          suggestion: 'Retry node start and inspect system process limits.',
        });
      } else {
        console.error(`❌ ${message}`);
      }
      process.exit(1);
    }

    if (json) {
      printJsonEvent('node_daemon_starting', {
        pid: childPid,
        runtimeDaemon: true,
      });
    } else {
      console.log(`Node daemon starting (PID: ${childPid})`);
      console.log('Use `fiber-pay node status --json` to verify readiness.');
    }
    return;
  }

  emitStage('init', 'ok', { rpcUrl: config.rpcUrl, dataDir: config.dataDir });
  const existingPid = readPidFile(config.dataDir);
  if (existingPid && isProcessRunning(existingPid)) {
    if (json) {
      printJsonError({
        code: 'NODE_ALREADY_RUNNING',
        message: `Node is already running (PID: ${existingPid})`,
        recoverable: true,
        suggestion: 'Skip start or run `fiber-pay node stop` before retrying.',
        details: { pid: existingPid },
      });
    } else {
      console.log(`❌ Node is already running (PID: ${existingPid})`);
    }
    process.exit(1);
  }

  const runtimeDaemon = process.env.FIBER_NODE_RUNTIME_DAEMON === '1';
  const runtimeProxyListen = String(
    options.runtimeProxyListen ?? config.runtimeProxyListen ?? '127.0.0.1:8229',
  );
  const proxyListenSource: 'cli' | 'profile' | 'default' = options.runtimeProxyListen
    ? 'cli'
    : config.runtimeProxyListen
      ? 'profile'
      : 'default';
  const runtimeStateFilePath = join(config.dataDir, 'runtime-state.json');
  const logsBaseDir = join(config.dataDir, 'logs');
  mkdirSync(logsBaseDir, { recursive: true });
  // Ensure today's date directory exists at startup
  resolveLogDirForDate(config.dataDir);

  const binaryPath = config.binaryPath || getDefaultBinaryPath();
  await ensureFiberBinary();
  const binaryVersion = getBinaryVersion(binaryPath);
  const configFilePath = ensureNodeConfigFile(config.dataDir, config.network);
  emitStage('binary_resolved', 'ok', {
    binaryPath,
    binaryVersion,
    configFilePath,
  });

  if (!json) {
    console.log(`🧩 Binary: ${binaryPath}`);
    console.log(`🧩 Version: ${binaryVersion}`);
  }

  // Check if database migration is needed before starting the node
  const guardResult = await runMigrationGuard({ dataDir: config.dataDir, binaryPath, json });
  if (guardResult.checked) {
    emitStage('migration_check', 'ok', {
      storePath: `${config.dataDir}/store`,
      needed: false,
    });
  } else {
    emitStage('migration_check', 'ok', {
      storePath: `${config.dataDir}/store`,
      skipped: true,
      reason: guardResult.skippedReason,
    });
  }

  const nodeConfig: FiberNodeConfig = {
    binaryPath,
    dataDir: config.dataDir,
    configFilePath,
    chain: config.network,
    keyPassword: config.keyPassword,
  };

  try {
    const keyManager = createKeyManager(config.dataDir, {
      encryptionPassword: config.keyPassword,
      autoGenerate: true,
    });
    await keyManager.initialize();
    emitStage('key_initialized', 'ok', {});
  } catch (error) {
    const message = `Failed to initialize node keys: ${error instanceof Error ? error.message : String(error)}`;
    emitStage('key_initialized', 'error', { code: 'NODE_KEY_INIT_FAILED', message });
    if (json) {
      printJsonError({
        code: 'NODE_KEY_INIT_FAILED',
        message,
        recoverable: true,
        suggestion: 'Verify key password and write permission for the data directory.',
        details: { dataDir: config.dataDir },
      });
    } else {
      console.error(`❌ ${message}`);
    }
    process.exit(1);
  }

  const processManager = new ProcessManager(nodeConfig);
  let earlyStop: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  const formatStopDetails = (
    stop: { code: number | null; signal: NodeJS.Signals | null } | null,
  ): string => {
    if (!stop) return '';
    return ` (code: ${stop.code ?? 'null'}, signal: ${stop.signal ?? 'null'})`;
  };
  processManager.on('stopped', (code, signal) => {
    earlyStop = { code, signal };
    removePidFile(config.dataDir);
  });
  processManager.on('stdout', (text) => {
    appendToTodayLog(config.dataDir, 'fnn.stdout.log', text);
    emitFnnLog('stdout', text);
  });
  processManager.on('stderr', (text) => {
    appendToTodayLog(config.dataDir, 'fnn.stderr.log', text);
    emitFnnLog('stderr', text);
  });
  await processManager.start();
  const processManagerState = processManager as unknown as {
    process?: { pid?: number };
  };
  const processId = processManagerState.process?.pid;
  if (processId !== undefined) {
    writePidFile(config.dataDir, processId);
  }
  emitStage('process_started', 'ok', { pid: processId ?? null });

  let runtime: Awaited<ReturnType<typeof startRuntimeService>> | undefined;

  const rpc = createRpcClient(config);
  let rpcReady = true;
  try {
    await rpc.waitForReady({ timeout: 30000, interval: 500 });
  } catch {
    rpcReady = false;
  }

  if (earlyStop || processManager.getState() === 'stopped') {
    const details = formatStopDetails(earlyStop);
    emitStage('process_started', 'error', {
      code: 'NODE_STARTUP_EXITED',
      details,
    });
    if (json) {
      printJsonError({
        code: 'NODE_STARTUP_EXITED',
        message: `Fiber node exited during startup${details}`,
        recoverable: true,
        suggestion: 'Inspect fnn logs and verify config ports are free before retrying.',
        details: earlyStop ?? undefined,
      });
    } else {
      console.error(`❌ Fiber node exited during startup${details}`);
    }
    removePidFile(config.dataDir);
    if (runtimeDaemon) {
      stopRuntimeDaemonFromNode({ dataDir: config.dataDir, rpcUrl: config.rpcUrl });
    } else if (runtime) {
      await runtime.stop().catch(() => undefined);
    }
    removeRuntimeFiles(config.dataDir);
    process.exit(1);
  }

  try {
    if (runtimeDaemon) {
      const daemonStart = startRuntimeDaemonFromNode({
        dataDir: config.dataDir,
        rpcUrl: config.rpcUrl,
        proxyListen: runtimeProxyListen,
        stateFilePath: runtimeStateFilePath,
        alertLogsBaseDir: logsBaseDir,
      });
      if (!daemonStart.ok) {
        throw new Error(daemonStart.message);
      }
    } else {
      runtime = await startRuntimeService({
        fiberRpcUrl: config.rpcUrl,
        proxy: {
          enabled: true,
          listen: runtimeProxyListen,
        },
        storage: {
          stateFilePath: runtimeStateFilePath,
        },
        alerts: [{ type: 'stdout' }, { type: 'daily-file', baseLogsDir: logsBaseDir }],
        jobs: {
          enabled: true,
          dbPath: join(config.dataDir, 'runtime-jobs.db'),
        },
      });

      const runtimeStatus = runtime.service.getStatus();
      writeRuntimePid(config.dataDir, process.pid);
      const todayLogDir = resolveLogDirForDate(config.dataDir);
      writeRuntimeMeta(config.dataDir, {
        pid: process.pid,
        startedAt: runtimeStatus.startedAt,
        fiberRpcUrl: runtimeStatus.targetUrl,
        proxyListen: runtimeStatus.proxyListen,
        stateFilePath: runtimeStateFilePath,
        alertLogFilePath: join(todayLogDir, 'runtime.alerts.jsonl'),
        fnnStdoutLogPath: join(todayLogDir, 'fnn.stdout.log'),
        fnnStderrLogPath: join(todayLogDir, 'fnn.stderr.log'),
        logsBaseDir,
        daemon: false,
      });
    }

    emitStage('runtime_started', 'ok', {
      proxyListen: runtimeProxyListen,
      daemon: runtimeDaemon,
    });
  } catch (error) {
    const message = `Runtime failed to start: ${error instanceof Error ? error.message : String(error)}`;
    emitStage('runtime_started', 'error', {
      code: 'NODE_RUNTIME_START_FAILED',
      message,
      proxyListen: runtimeProxyListen,
    });
    if (json) {
      printJsonError({
        code: 'NODE_RUNTIME_START_FAILED',
        message,
        recoverable: true,
        suggestion: 'Retry with a free --runtime-proxy-listen port.',
        details: {
          runtimeProxyListen,
        },
      });
    } else {
      console.error(`❌ ${message}`);
    }

    removeRuntimeFiles(config.dataDir);
    removePidFile(config.dataDir);
    await processManager.stop().catch(() => undefined);
    process.exit(1);
  }

  if (!rpcReady) {
    emitStage('rpc_ready', 'error', {
      code: 'NODE_RPC_NOT_READY',
      timeoutSeconds: 30,
    });
    if (json) {
      printJsonError({
        code: 'NODE_RPC_NOT_READY',
        message: 'RPC did not become ready within 30s. Node startup failed.',
        recoverable: true,
        suggestion: 'Retry after a delay and verify RPC port + config consistency.',
        details: { timeoutSeconds: 30, rpcUrl: config.rpcUrl },
      });
    } else {
      console.error('❌ RPC did not become ready within 30s. Node startup failed.');
    }
    const stderrTail = processManager.getStderr(12).join('').trim();
    const stdoutTail = processManager.getStdout(12).join('').trim();
    if (!json && stderrTail.length > 0) {
      console.error('--- fnn stderr (tail) ---');
      console.error(stderrTail);
    }
    if (!json && stdoutTail.length > 0) {
      console.error('--- fnn stdout (tail) ---');
      console.error(stdoutTail);
    }

    removePidFile(config.dataDir);
    if (runtimeDaemon) {
      stopRuntimeDaemonFromNode({ dataDir: config.dataDir, rpcUrl: config.rpcUrl });
    } else if (runtime) {
      await runtime.stop().catch(() => undefined);
      removeRuntimeFiles(config.dataDir);
    }
    await processManager.stop().catch(() => undefined);
    process.exit(1);
  }
  emitStage('rpc_ready', 'ok', { rpcUrl: config.rpcUrl });

  const bootnodes = nodeConfig.configFilePath
    ? extractBootnodeAddrs(nodeConfig.configFilePath)
    : extractBootnodeAddrs(join(config.dataDir, 'config.yml'));
  if (bootnodes.length > 0) {
    await autoConnectBootnodes(rpc, bootnodes);
  }
  emitStage('bootnodes_connected', 'ok', { count: bootnodes.length });

  if (earlyStop || processManager.getState() === 'stopped') {
    const details = formatStopDetails(earlyStop);
    emitStage('bootnodes_connected', 'error', {
      code: 'NODE_STARTUP_EXITED',
      details,
    });
    if (json) {
      printJsonError({
        code: 'NODE_STARTUP_EXITED',
        message: `Fiber node exited during startup${details}`,
        recoverable: true,
        suggestion: 'Inspect fnn logs and verify config ports are free before retrying.',
        details: earlyStop ?? undefined,
      });
    } else {
      console.error(`❌ Fiber node exited during startup${details}`);
    }
    removePidFile(config.dataDir);
    process.exit(1);
  }

  if (json) {
    emitStage('startup_complete', 'ok', {
      pid: processId ?? null,
      rpcUrl: config.rpcUrl,
    });
    printJsonEvent('node_started', {
      rpcUrl: config.rpcUrl,
      binaryPath,
      binaryVersion,
      pid: processId ?? null,
      runtimeEnabled: true,
      runtimeDaemon,
      quietFnn,
      proxyUrl: `http://${runtimeProxyListen}`,
      proxyListenSource,
      logs: {
        baseDir: logsBaseDir,
        todayDir: resolveLogDirForDate(config.dataDir),
      },
    });
  } else {
    console.log('✅ Fiber node started successfully!');
    console.log(`   RPC endpoint: ${config.rpcUrl}`);
    console.log(
      `   Runtime proxy: http://${runtimeProxyListen} (browser-safe endpoint + monitoring)`,
    );
    console.log(`   Runtime mode:  ${runtimeDaemon ? 'daemon' : 'embedded'}`);
    console.log(`   Log files:     ${logsBaseDir}`);
    console.log('   Press Ctrl+C to stop.');
  }

  let shutdownRequested = false;
  const shutdown = async () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    if (!json) {
      console.log('\n🛑 Shutting down...');
    }
    if (runtimeDaemon) {
      stopRuntimeDaemonFromNode({ dataDir: config.dataDir, rpcUrl: config.rpcUrl });
    } else if (runtime) {
      await runtime.stop();
    }
    removeRuntimeFiles(config.dataDir);
    removePidFile(config.dataDir);
    await processManager.stop();
    if (json) {
      printJsonEvent('node_stopped', { reason: 'signal' });
    } else {
      console.log('✅ Node stopped.');
    }
  };

  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => undefined, 60_000);

    const cleanup = () => {
      clearInterval(keepAlive);
      process.off('SIGINT', onSigInt);
      process.off('SIGTERM', onSigTerm);
      processManager.off('stopped', onStopped);
      resolve();
    };

    const onStopped = () => {
      cleanup();
    };

    const onSigInt = () => {
      shutdown().finally(cleanup);
    };

    const onSigTerm = () => {
      shutdown().finally(cleanup);
    };

    process.on('SIGINT', onSigInt);
    process.on('SIGTERM', onSigTerm);
    processManager.on('stopped', onStopped);
  });

  if (!shutdownRequested) {
    if (json) {
      printJsonError({
        code: 'NODE_STOPPED_UNEXPECTEDLY',
        message: 'Fiber node stopped unexpectedly.',
        recoverable: true,
        suggestion: 'Check process logs and restart the node when configuration is healthy.',
      });
    } else {
      console.error('❌ Fiber node stopped unexpectedly.');
    }
    removePidFile(config.dataDir);
    if (runtimeDaemon) {
      stopRuntimeDaemonFromNode({ dataDir: config.dataDir, rpcUrl: config.rpcUrl });
    }
    removeRuntimeFiles(config.dataDir);
    process.exit(1);
  }
}
