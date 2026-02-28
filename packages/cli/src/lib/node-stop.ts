/**
 * Implementation of `fiber-pay node stop`.
 */

import type { CliConfig } from './config.js';
import { printJsonError, printJsonSuccess } from './format.js';
import { stopRuntimeDaemonFromNode } from './node-runtime-daemon.js';
import { isProcessRunning, readPidFile, removePidFile } from './pid.js';
import { readRuntimeMeta, readRuntimePid, removeRuntimeFiles } from './runtime-meta.js';

export interface NodeStopOptions {
  json?: boolean;
}

export async function runNodeStopCommand(
  config: CliConfig,
  options: NodeStopOptions,
): Promise<void> {
  const json = Boolean(options.json);

  // Shut down the runtime daemon if running
  const runtimeMeta = readRuntimeMeta(config.dataDir);
  const runtimePid = readRuntimePid(config.dataDir);
  if (runtimeMeta?.daemon && runtimePid && isProcessRunning(runtimePid)) {
    stopRuntimeDaemonFromNode({ dataDir: config.dataDir, rpcUrl: config.rpcUrl });
  }
  removeRuntimeFiles(config.dataDir);

  // Check for fnn PID
  const pid = readPidFile(config.dataDir);
  if (!pid) {
    if (json) {
      printJsonError({
        code: 'NODE_NOT_RUNNING',
        message: 'No PID file found. Node may not be running.',
        recoverable: true,
        suggestion: 'Run `fiber-pay node start` first if you intend to stop a node.',
      });
    } else {
      console.log('❌ No PID file found. Node may not be running.');
    }
    process.exit(1);
  }

  if (!isProcessRunning(pid)) {
    if (json) {
      printJsonError({
        code: 'NODE_NOT_RUNNING',
        message: `Process ${pid} is not running. Cleaning up PID file.`,
        recoverable: true,
        suggestion: 'Start the node again if needed; stale PID has been cleaned.',
        details: { pid, stalePidFileCleaned: true },
      });
    } else {
      console.log(`❌ Process ${pid} is not running. Cleaning up PID file.`);
    }
    removePidFile(config.dataDir);
    process.exit(1);
  }

  if (!json) {
    console.log(`🛑 Stopping node (PID: ${pid})...`);
  }
  process.kill(pid, 'SIGTERM');

  // Wait up to 3 seconds for graceful shutdown
  let attempts = 0;
  while (isProcessRunning(pid) && attempts < 30) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  if (isProcessRunning(pid)) {
    process.kill(pid, 'SIGKILL');
  }

  removePidFile(config.dataDir);
  if (json) {
    printJsonSuccess({ pid, stopped: true });
  } else {
    console.log('✅ Node stopped.');
  }
}
