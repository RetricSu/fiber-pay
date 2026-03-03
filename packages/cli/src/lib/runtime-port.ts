import { spawnSync } from 'node:child_process';
import { isProcessRunning } from './pid.js';

export interface PortProcessInfo {
  pid: number;
  command?: string;
}

export function parsePortFromListen(listen: string): number | undefined {
  const value = listen.trim();
  if (!value) {
    return undefined;
  }

  const lastColon = value.lastIndexOf(':');
  if (lastColon < 0 || lastColon === value.length - 1) {
    return undefined;
  }

  const port = Number(value.slice(lastColon + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }
  return port;
}

export function extractFirstPidFromLsofOutput(output: string): number | undefined {
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('p') || trimmed.length < 2) {
      continue;
    }
    const pid = Number(trimmed.slice(1));
    if (Number.isInteger(pid) && pid > 0) {
      return pid;
    }
  }
  return undefined;
}

export function readProcessCommand(pid: number): string | undefined {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf-8',
  });
  if (result.error || result.status !== 0) {
    return undefined;
  }
  const command = (result.stdout ?? '').trim();
  return command.length > 0 ? command : undefined;
}

export function findListeningProcessByPort(listen: string): PortProcessInfo | undefined {
  const port = parsePortFromListen(listen);
  if (!port) {
    return undefined;
  }

  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {
    encoding: 'utf-8',
  });
  if (result.error || result.status !== 0) {
    return undefined;
  }

  const pid = extractFirstPidFromLsofOutput(result.stdout ?? '');
  if (!pid) {
    return undefined;
  }

  return {
    pid,
    command: readProcessCommand(pid),
  };
}

export function isFiberRuntimeCommand(command: string | undefined): boolean {
  if (!command) {
    return false;
  }

  const normalized = command.toLowerCase();
  const hasFiberIdentifier =
    normalized.includes('fiber-pay') ||
    normalized.includes('@fiber-pay/cli') ||
    normalized.includes('/packages/cli/dist/cli.js') ||
    normalized.includes('\\packages\\cli\\dist\\cli.js') ||
    normalized.includes('/dist/cli.js') ||
    normalized.includes('\\dist\\cli.js');

  if (!hasFiberIdentifier) {
    return false;
  }

  return normalized.includes('runtime') && normalized.includes('start');
}

export async function terminateProcess(pid: number, timeoutMs = 5_000): Promise<boolean> {
  if (!isProcessRunning(pid)) {
    return true;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if ((error as { code?: string }).code === 'ESRCH') {
      return true;
    }
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!isProcessRunning(pid)) {
    return true;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if ((error as { code?: string }).code === 'ESRCH') {
      return true;
    }
    return false;
  }

  const killDeadline = Date.now() + 1_000;
  while (Date.now() < killDeadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return !isProcessRunning(pid);
}
