import { dirname, join } from 'node:path';
import { BinaryManager } from '@fiber-pay/node';
import type { CliConfig } from './config.js';

export interface ResolvedBinaryPath {
  binaryPath: string;
  installDir: string;
  source: 'configured-path' | 'profile-managed';
}

export function getProfileBinaryInstallDir(dataDir: string): string {
  return join(dataDir, 'bin');
}

export function getProfileManagedBinaryPath(dataDir: string): string {
  return new BinaryManager(getProfileBinaryInstallDir(dataDir)).getBinaryPath();
}

export function resolveBinaryPath(config: CliConfig): ResolvedBinaryPath {
  if (config.binaryPath) {
    return {
      binaryPath: config.binaryPath,
      installDir: dirname(config.binaryPath),
      source: 'configured-path',
    };
  }

  const installDir = getProfileBinaryInstallDir(config.dataDir);
  const binaryPath = getProfileManagedBinaryPath(config.dataDir);
  return {
    binaryPath,
    installDir,
    source: 'profile-managed',
  };
}
