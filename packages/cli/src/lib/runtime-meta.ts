import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RuntimeMeta {
  pid: number;
  startedAt: string;
  fiberRpcUrl: string;
  proxyListen: string;
  stateFilePath?: string;
  alertLogFilePath?: string;
  fnnStdoutLogPath?: string;
  fnnStderrLogPath?: string;
  /** Base logs directory for discovering daily log directories. */
  logsBaseDir?: string;
  daemon: boolean;
}

export function getRuntimePidFilePath(dataDir: string): string {
  return join(dataDir, 'runtime.pid');
}

export function getRuntimeMetaFilePath(dataDir: string): string {
  return join(dataDir, 'runtime.meta.json');
}

export function writeRuntimePid(dataDir: string, pid: number): void {
  writeFileSync(getRuntimePidFilePath(dataDir), String(pid));
}

export function readRuntimePid(dataDir: string): number | null {
  const pidPath = getRuntimePidFilePath(dataDir);
  if (!existsSync(pidPath)) return null;
  try {
    return Number.parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

export function writeRuntimeMeta(dataDir: string, meta: RuntimeMeta): void {
  writeFileSync(getRuntimeMetaFilePath(dataDir), JSON.stringify(meta, null, 2));
}

export function readRuntimeMeta(dataDir: string): RuntimeMeta | null {
  const metaPath = getRuntimeMetaFilePath(dataDir);
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8')) as RuntimeMeta;
  } catch {
    return null;
  }
}

export function removeRuntimeFiles(dataDir: string): void {
  const pidPath = getRuntimePidFilePath(dataDir);
  const metaPath = getRuntimeMetaFilePath(dataDir);
  if (existsSync(pidPath)) {
    unlinkSync(pidPath);
  }
  if (existsSync(metaPath)) {
    unlinkSync(metaPath);
  }
}
