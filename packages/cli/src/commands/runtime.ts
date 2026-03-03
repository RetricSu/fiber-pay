import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { Alert, AlertPriority, AlertType, RuntimeConfigInput } from '@fiber-pay/runtime';
import {
  alertPriorityOrder,
  formatRuntimeAlert,
  isAlertPriority,
  isAlertType,
  startRuntimeService,
} from '@fiber-pay/runtime';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonError, printJsonEvent, printJsonSuccess } from '../lib/format.js';
import { resolveLogDirForDateWithOptions } from '../lib/log-files.js';
import { parseBoolOption, parseIntegerOption } from '../lib/parse-options.js';
import { isProcessRunning } from '../lib/pid.js';
import {
  readRuntimeMeta,
  readRuntimePid,
  removeRuntimeFiles,
  writeRuntimeMeta,
  writeRuntimePid,
} from '../lib/runtime-meta.js';
import {
  findListeningProcessByPort,
  isFiberRuntimeCommand,
  terminateProcess,
} from '../lib/runtime-port.js';

interface RuntimeLogFilter {
  minPriority?: AlertPriority;
  types?: Set<AlertType>;
}

function formatRuntimeAlertLine(alert: Alert): string {
  return formatRuntimeAlert(alert);
}

function parseAlertPriorityOption(value: string | undefined): AlertPriority | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!isAlertPriority(normalized)) {
    throw new Error(`Invalid log-min-priority: ${value}. Expected critical|high|medium|low.`);
  }
  return normalized;
}

function parseAlertTypesOption(value: string | undefined): Set<AlertType> | undefined {
  if (!value) {
    return undefined;
  }

  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return undefined;
  }

  const result = new Set<AlertType>();
  for (const token of tokens) {
    if (!isAlertType(token)) {
      throw new Error(`Invalid log-type: ${token}. Use runtime alert type names, comma-separated.`);
    }
    result.add(token);
  }

  return result;
}

function shouldPrintAlert(alert: Alert, filter: RuntimeLogFilter): boolean {
  if (filter.minPriority) {
    const minimumRank = alertPriorityOrder[filter.minPriority];
    if (alertPriorityOrder[alert.priority] < minimumRank) {
      return false;
    }
  }

  if (filter.types && filter.types.size > 0 && !filter.types.has(alert.type)) {
    return false;
  }

  return true;
}

function resolveRuntimeRecoveryListen(config: CliConfig): string {
  const meta = readRuntimeMeta(config.dataDir);
  return meta?.proxyListen ?? config.runtimeProxyListen ?? '127.0.0.1:8229';
}

export function createRuntimeCommand(config: CliConfig): Command {
  const runtime = new Command('runtime').description('Polling monitor and alert runtime service');

  runtime
    .command('start')
    .description('Start runtime monitor service in foreground')
    .option('--daemon', 'Start runtime monitor in detached background mode')
    .option('--fiber-rpc-url <url>', 'Target fiber rpc URL (defaults to --rpc-url/global config)')
    .option('--proxy-listen <host:port>', 'Monitor proxy listen address')
    .option('--channel-poll-ms <ms>', 'Channel polling interval in milliseconds')
    .option('--invoice-poll-ms <ms>', 'Invoice polling interval in milliseconds')
    .option('--payment-poll-ms <ms>', 'Payment polling interval in milliseconds')
    .option('--peer-poll-ms <ms>', 'Peer polling interval in milliseconds')
    .option('--health-poll-ms <ms>', 'RPC health polling interval in milliseconds')
    .option('--include-closed <bool>', 'Monitor closed channels (true|false)')
    .option('--completed-ttl-seconds <seconds>', 'TTL for completed invoices/payments in tracker')
    .option('--state-file <path>', 'State file path for snapshots and history')
    .option('--alert-log-file <path>', 'Path to runtime alert JSONL log file (legacy static path)')
    .option('--alert-logs-base-dir <dir>', 'Base logs directory for daily-rotated alert files')
    .option('--flush-ms <ms>', 'State flush interval in milliseconds')
    .option('--webhook <url>', 'Webhook URL to receive alert POST payloads')
    .option('--websocket <host:port>', 'WebSocket alert broadcast listen address')
    .option(
      '--log-min-priority <priority>',
      'Minimum runtime log priority (critical|high|medium|low)',
    )
    .option('--log-type <types>', 'Comma-separated runtime alert types to print')
    .option('--json')
    .action(async (options) => {
      const asJson = Boolean(options.json);
      const daemon = Boolean(options.daemon);
      const isRuntimeChild = process.env.FIBER_RUNTIME_CHILD === '1';
      const runtimeListen = String(
        options.proxyListen ?? config.runtimeProxyListen ?? '127.0.0.1:8229',
      );

      try {
        const existingPid = readRuntimePid(config.dataDir);
        if (
          existingPid &&
          isProcessRunning(existingPid) &&
          (!isRuntimeChild || existingPid !== process.pid)
        ) {
          const message = `Runtime already running (PID: ${existingPid})`;
          if (asJson) {
            printJsonError({
              code: 'RUNTIME_ALREADY_RUNNING',
              message,
              recoverable: true,
              suggestion: 'Run `fiber-pay runtime status` or `fiber-pay runtime stop` first.',
            });
          } else {
            console.error(`Error: ${message}`);
          }
          process.exit(1);
        }
        if (existingPid && !isProcessRunning(existingPid)) {
          removeRuntimeFiles(config.dataDir);
        }

        const discovered = findListeningProcessByPort(runtimeListen);
        if (discovered && (!existingPid || discovered.pid !== existingPid)) {
          if (isFiberRuntimeCommand(discovered.command)) {
            const terminated = await terminateProcess(discovered.pid);
            if (!terminated) {
              throw new Error(
                `Runtime port ${runtimeListen} is occupied by stale fiber-pay runtime PID ${discovered.pid} but termination failed.`,
              );
            }
            removeRuntimeFiles(config.dataDir);
            if (!asJson) {
              console.log(
                `Recovered stale runtime process on ${runtimeListen} (PID: ${discovered.pid}).`,
              );
            }
          } else if (discovered.command) {
            const details = discovered.command
              ? `PID ${discovered.pid} (${discovered.command})`
              : `PID ${discovered.pid}`;
            throw new Error(
              `Runtime proxy listen ${runtimeListen} is already in use by non-fiber-pay process: ${details}`,
            );
          } else {
            throw new Error(
              `Runtime proxy listen ${runtimeListen} is already in use by process PID ${discovered.pid}. ` +
                'Unable to determine the owning command; inspect this PID manually before retrying.',
            );
          }
        }

        if (daemon && !isRuntimeChild) {
          const childArgv = process.argv.filter((arg) => arg !== '--daemon');
          const child = spawn(process.execPath, childArgv.slice(1), {
            detached: true,
            stdio: 'ignore',
            cwd: process.cwd(),
            env: {
              ...process.env,
              FIBER_RUNTIME_CHILD: '1',
            },
          });
          child.unref();

          const childPid = child.pid;
          if (!childPid) {
            throw new Error('Failed to spawn runtime daemon process');
          }

          writeRuntimePid(config.dataDir, childPid);

          if (asJson) {
            printJsonSuccess({
              daemon: true,
              pid: childPid,
              message: 'Runtime daemon starting',
            });
          } else {
            console.log(`Runtime daemon starting (PID: ${childPid})`);
          }
          return;
        }

        const runtimeConfig: RuntimeConfigInput = {
          fiberRpcUrl: String(options.fiberRpcUrl ?? config.rpcUrl),
          channelPollIntervalMs: parseIntegerOption(options.channelPollMs, 'channel-poll-ms'),
          invoicePollIntervalMs: parseIntegerOption(options.invoicePollMs, 'invoice-poll-ms'),
          paymentPollIntervalMs: parseIntegerOption(options.paymentPollMs, 'payment-poll-ms'),
          peerPollIntervalMs: parseIntegerOption(options.peerPollMs, 'peer-poll-ms'),
          healthPollIntervalMs: parseIntegerOption(options.healthPollMs, 'health-poll-ms'),
          includeClosedChannels: parseBoolOption(options.includeClosed, 'include-closed'),
          completedItemTtlSeconds: parseIntegerOption(
            options.completedTtlSeconds,
            'completed-ttl-seconds',
          ),
          proxy: {
            enabled: true,
            listen: runtimeListen,
          },
          storage: {
            stateFilePath: options.stateFile
              ? resolve(String(options.stateFile))
              : resolve(config.dataDir, 'runtime-state.json'),
            flushIntervalMs: parseIntegerOption(options.flushMs, 'flush-ms'),
          },
          jobs: {
            enabled: true,
            dbPath: resolve(config.dataDir, 'runtime-jobs.db'),
          },
        };

        // Determine alert backend: prefer daily-file rotation, fall back to static file
        let alertLogsBaseDir: string | undefined;
        let alertLogFile: string | undefined;

        if (options.alertLogsBaseDir) {
          alertLogsBaseDir = resolve(String(options.alertLogsBaseDir));
        } else if (options.alertLogFile) {
          alertLogFile = resolve(String(options.alertLogFile));
        } else {
          alertLogsBaseDir = resolve(config.dataDir, 'logs');
        }

        const alerts: RuntimeConfigInput['alerts'] = [{ type: 'stdout' }];
        if (alertLogsBaseDir) {
          alerts.push({ type: 'daily-file', baseLogsDir: alertLogsBaseDir });
        } else if (alertLogFile) {
          alerts.push({ type: 'file', path: alertLogFile });
        }
        if (options.webhook) {
          alerts.push({ type: 'webhook', url: String(options.webhook) });
        }
        if (options.websocket) {
          alerts.push({ type: 'websocket', listen: String(options.websocket) });
        }
        runtimeConfig.alerts = alerts;

        const logFilter: RuntimeLogFilter = {
          minPriority: parseAlertPriorityOption(options.logMinPriority),
          types: parseAlertTypesOption(options.logType),
        };

        if (asJson) {
          printJsonEvent('runtime_starting', {
            fiberRpcUrl: runtimeConfig.fiberRpcUrl,
            proxyListen: runtimeConfig.proxy?.listen,
          });
        } else {
          console.log('Starting fiber runtime monitor...');
        }

        const runtime = await startRuntimeService(runtimeConfig);
        const status = runtime.service.getStatus();

        const logsBaseDir = alertLogsBaseDir ?? resolve(config.dataDir, 'logs');
        const todayLogDir = resolveLogDirForDateWithOptions(config.dataDir, undefined, {
          logsBaseDir,
          ensureExists: false,
        });
        const effectiveAlertLogPath = alertLogsBaseDir
          ? join(todayLogDir, 'runtime.alerts.jsonl')
          : (alertLogFile ?? join(todayLogDir, 'runtime.alerts.jsonl'));

        writeRuntimePid(config.dataDir, process.pid);
        writeRuntimeMeta(config.dataDir, {
          pid: process.pid,
          startedAt: status.startedAt,
          fiberRpcUrl: status.targetUrl,
          proxyListen: status.proxyListen,
          stateFilePath: runtimeConfig.storage?.stateFilePath,
          alertLogFilePath: effectiveAlertLogPath,
          fnnStdoutLogPath: join(todayLogDir, 'fnn.stdout.log'),
          fnnStderrLogPath: join(todayLogDir, 'fnn.stderr.log'),
          logsBaseDir,
          daemon: daemon || isRuntimeChild,
        });

        runtime.service.on('alert', (alert) => {
          if (!shouldPrintAlert(alert, logFilter)) {
            return;
          }

          if (asJson) {
            printJsonEvent('runtime_alert', alert);
            return;
          }
          console.log(formatRuntimeAlertLine(alert));
        });

        if (asJson) {
          printJsonSuccess({
            status: 'running',
            fiberRpcUrl: status.targetUrl,
            proxyListen: status.proxyListen,
            stateFilePath: runtimeConfig.storage?.stateFilePath,
            alertLogFile: effectiveAlertLogPath,
            logsBaseDir,
          });
          printJsonEvent('runtime_started', status);
        } else {
          console.log(`Fiber RPC:    ${status.targetUrl}`);
          console.log(`Proxy listen: ${status.proxyListen}`);
          console.log(`State file:   ${runtimeConfig.storage?.stateFilePath}`);
          console.log(`Logs dir:     ${logsBaseDir}`);
          console.log(`Alert log:    ${effectiveAlertLogPath}`);
          console.log('Runtime monitor is running. Press Ctrl+C to stop.');
        }

        const signal = await runtime.waitForShutdownSignal();

        if (asJson) {
          printJsonEvent('runtime_stopping', { signal });
        } else {
          console.log(`Stopping runtime monitor on ${signal}...`);
        }

        await runtime.stop();
        removeRuntimeFiles(config.dataDir);

        if (asJson) {
          printJsonEvent('runtime_stopped', { signal });
        } else {
          console.log('Runtime monitor stopped.');
        }
      } catch (error) {
        removeRuntimeFiles(config.dataDir);
        const message = error instanceof Error ? error.message : String(error);
        if (asJson) {
          printJsonError({
            code: 'RUNTIME_START_FAILED',
            message,
            recoverable: true,
            suggestion: 'Check RPC URL reachability and runtime option values, then retry.',
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }
    });

  runtime
    .command('status')
    .description('Show runtime process and health status')
    .option('--json')
    .action(async (options) => {
      const asJson = Boolean(options.json);
      let pid = readRuntimePid(config.dataDir);
      const meta = readRuntimeMeta(config.dataDir);
      const recoveryListen = resolveRuntimeRecoveryListen(config);

      if (!pid) {
        const fallback = findListeningProcessByPort(recoveryListen);
        if (fallback && isFiberRuntimeCommand(fallback.command)) {
          pid = fallback.pid;
          writeRuntimePid(config.dataDir, pid);
        } else if (fallback && fallback.command) {
          const details = fallback.command
            ? `PID ${fallback.pid} (${fallback.command})`
            : `PID ${fallback.pid}`;
          if (asJson) {
            printJsonError({
              code: 'RUNTIME_PORT_IN_USE',
              message: `Runtime proxy port is in use by non-fiber-pay process: ${details}`,
              recoverable: true,
              suggestion: 'Stop that process or use a different --proxy-listen port.',
            });
          } else {
            console.log(`Runtime proxy port is in use by non-fiber-pay process: ${details}`);
          }
          process.exit(1);
        } else if (fallback) {
          const message =
            `Runtime proxy port is in use by process PID ${fallback.pid}. ` +
            'The owning command could not be determined; inspect this PID manually.';
          if (asJson) {
            printJsonError({
              code: 'RUNTIME_PORT_IN_USE',
              message,
              recoverable: true,
              suggestion: 'Inspect the PID owner manually or use a different --proxy-listen port.',
            });
          } else {
            console.log(message);
          }
          process.exit(1);
        }
      }

      if (!pid) {
        if (asJson) {
          printJsonError({
            code: 'RUNTIME_NOT_RUNNING',
            message: 'Runtime PID file not found.',
            recoverable: true,
            suggestion: 'Start runtime with `fiber-pay runtime start --daemon`.',
          });
        } else {
          console.log('Runtime is not running.');
        }
        process.exit(1);
      }

      const running = isProcessRunning(pid);
      if (!running) {
        removeRuntimeFiles(config.dataDir);
        if (asJson) {
          printJsonError({
            code: 'RUNTIME_NOT_RUNNING',
            message: `Runtime process ${pid} is not running. Stale runtime files cleaned.`,
            recoverable: true,
            suggestion: 'Start runtime again with `fiber-pay runtime start`.',
            details: { pid, staleFilesCleaned: true },
          });
        } else {
          console.log(`Runtime process ${pid} is not running. Stale runtime files cleaned.`);
        }
        process.exit(1);
      }

      let rpcStatus: unknown;
      if (meta?.proxyListen ?? recoveryListen) {
        try {
          const response = await fetch(
            `http://${meta?.proxyListen ?? recoveryListen}/monitor/status`,
          );
          if (response.ok) {
            rpcStatus = await response.json();
          }
        } catch {
          rpcStatus = undefined;
        }
      }

      const payload = {
        running: true,
        pid,
        meta,
        proxyStatus: rpcStatus,
      };

      if (asJson) {
        printJsonSuccess(payload);
      } else {
        console.log(`Runtime is running (PID: ${pid})`);
        if (meta?.fiberRpcUrl) {
          console.log(`Fiber RPC:    ${meta.fiberRpcUrl}`);
        }
        if (meta?.proxyListen) {
          console.log(`Proxy listen: ${meta.proxyListen}`);
        }
      }
    });

  runtime
    .command('stop')
    .description('Stop runtime process by PID')
    .option('--json')
    .action(async (options) => {
      const asJson = Boolean(options.json);
      let pid = readRuntimePid(config.dataDir);
      const recoveryListen = resolveRuntimeRecoveryListen(config);

      if (!pid) {
        const fallback = findListeningProcessByPort(recoveryListen);
        if (fallback && isFiberRuntimeCommand(fallback.command)) {
          pid = fallback.pid;
          writeRuntimePid(config.dataDir, pid);
        } else if (fallback && fallback.command) {
          const details = fallback.command
            ? `PID ${fallback.pid} (${fallback.command})`
            : `PID ${fallback.pid}`;
          if (asJson) {
            printJsonError({
              code: 'RUNTIME_PORT_IN_USE',
              message: `Runtime proxy port is in use by non-fiber-pay process: ${details}`,
              recoverable: true,
              suggestion:
                'Stop that process manually; it is not managed by fiber-pay runtime PID files.',
            });
          } else {
            console.log(`Runtime proxy port is in use by non-fiber-pay process: ${details}`);
          }
          process.exit(1);
        } else if (fallback) {
          const message =
            `Runtime proxy port is in use by process PID ${fallback.pid}. ` +
            'The owning command could not be determined; inspect this PID manually.';
          if (asJson) {
            printJsonError({
              code: 'RUNTIME_PORT_IN_USE',
              message,
              recoverable: true,
              suggestion:
                'Inspect the PID owner manually; it may not be managed by fiber-pay runtime PID files.',
            });
          } else {
            console.log(message);
          }
          process.exit(1);
        }
      }

      if (!pid) {
        if (asJson) {
          printJsonError({
            code: 'RUNTIME_NOT_RUNNING',
            message: 'Runtime PID file not found.',
            recoverable: true,
            suggestion: 'Start runtime first with `fiber-pay runtime start --daemon`.',
          });
        } else {
          console.log('Runtime is not running.');
        }
        process.exit(1);
      }

      if (!isProcessRunning(pid)) {
        removeRuntimeFiles(config.dataDir);
        if (asJson) {
          printJsonError({
            code: 'RUNTIME_NOT_RUNNING',
            message: `Runtime process ${pid} is not running. Stale runtime files cleaned.`,
            recoverable: true,
            suggestion: 'Start runtime again if needed.',
            details: { pid, staleFilesCleaned: true },
          });
        } else {
          console.log(`Runtime process ${pid} is not running. Stale runtime files cleaned.`);
        }
        process.exit(1);
      }

      const terminated = await terminateProcess(pid);
      if (!terminated) {
        if (asJson) {
          printJsonError({
            code: 'RUNTIME_STOP_FAILED',
            message: `Failed to terminate runtime process ${pid}.`,
            recoverable: true,
            suggestion: `Try stopping PID ${pid} manually and rerun runtime stop.`,
          });
        } else {
          console.log(`Failed to terminate runtime process ${pid}.`);
        }
        process.exit(1);
      }

      removeRuntimeFiles(config.dataDir);
      if (asJson) {
        printJsonSuccess({ stopped: true, pid });
      } else {
        console.log(`Runtime stopped (PID: ${pid})`);
      }
    });

  return runtime;
}
