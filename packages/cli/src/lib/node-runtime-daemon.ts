import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export function getCustomBinaryState(binaryPath: string): {
  path: string;
  ready: boolean;
  version: string;
} {
  const exists = existsSync(binaryPath);
  if (!exists) {
    return { path: binaryPath, ready: false, version: 'unknown' };
  }

  try {
    const result = spawnSync(binaryPath, ['--version'], { encoding: 'utf-8' });
    if (result.status !== 0) {
      return { path: binaryPath, ready: false, version: 'unknown' };
    }
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    const firstLine = output.split('\n').find((line) => line.trim().length > 0) ?? 'unknown';
    return { path: binaryPath, ready: true, version: firstLine.trim() };
  } catch {
    return { path: binaryPath, ready: false, version: 'unknown' };
  }
}

export function getBinaryVersion(binaryPath: string): string {
  try {
    const result = spawnSync(binaryPath, ['--version'], { encoding: 'utf-8' });
    if (result.status !== 0) {
      return 'unknown';
    }
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (!output) {
      return 'unknown';
    }
    const firstLine = output.split('\n').find((line) => line.trim().length > 0);
    return firstLine?.trim() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function getCliEntrypoint(): string {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error('Unable to resolve CLI entrypoint path');
  }
  return entrypoint;
}

export function startRuntimeDaemonFromNode(params: {
  dataDir: string;
  rpcUrl: string;
  proxyListen: string;
  stateFilePath: string;
  alertLogsBaseDir: string;
}): { ok: true } | { ok: false; message: string } {
  const cliEntrypoint = getCliEntrypoint();
  const result = spawnSync(
    process.execPath,
    [
      cliEntrypoint,
      '--data-dir',
      params.dataDir,
      '--rpc-url',
      params.rpcUrl,
      'runtime',
      'start',
      '--daemon',
      '--fiber-rpc-url',
      params.rpcUrl,
      '--proxy-listen',
      params.proxyListen,
      '--state-file',
      params.stateFilePath,
      '--alert-logs-base-dir',
      params.alertLogsBaseDir,
      '--json',
    ],
    { encoding: 'utf-8' },
  );

  if (result.status === 0) {
    return { ok: true };
  }

  const stderr = (result.stderr ?? '').trim();
  const stdout = (result.stdout ?? '').trim();
  const details = stderr || stdout || `exit code ${result.status ?? 'unknown'}`;
  return { ok: false, message: details };
}

export function stopRuntimeDaemonFromNode(params: { dataDir: string; rpcUrl: string }): void {
  const cliEntrypoint = getCliEntrypoint();
  spawnSync(
    process.execPath,
    [
      cliEntrypoint,
      '--data-dir',
      params.dataDir,
      '--rpc-url',
      params.rpcUrl,
      'runtime',
      'stop',
      '--json',
    ],
    { encoding: 'utf-8' },
  );
}
