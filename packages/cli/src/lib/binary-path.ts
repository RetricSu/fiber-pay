import { dirname, join } from 'node:path';
import { type BinaryInfo, BinaryManager, getFiberBinaryInfo } from '@fiber-pay/node';
import type { CliConfig } from './config.js';
import { getCustomBinaryState } from './node-runtime-daemon.js';

export interface ResolvedBinaryPath {
  binaryPath: string;
  installDir: string | null;
  managedPath: string;
  managedByBinaryManager: boolean;
  source: 'configured-path' | 'profile-managed';
}

export function getProfileBinaryInstallDir(dataDir: string): string {
  return join(dataDir, 'bin');
}

export function getProfileManagedBinaryPath(dataDir: string): string {
  return new BinaryManager(getProfileBinaryInstallDir(dataDir)).getBinaryPath();
}

function validateConfiguredBinaryPath(binaryPath: string): string {
  const value = binaryPath.trim();
  if (!value) {
    throw new Error('Configured binaryPath cannot be empty');
  }
  if (value.includes('\0')) {
    throw new Error('Configured binaryPath contains an invalid null byte');
  }
  return value;
}

export function resolveBinaryPath(config: CliConfig): ResolvedBinaryPath {
  const managedPath = getProfileManagedBinaryPath(config.dataDir);

  if (config.binaryPath) {
    const binaryPath = validateConfiguredBinaryPath(config.binaryPath);
    const installDir = dirname(binaryPath);
    const expectedPath = new BinaryManager(installDir).getBinaryPath();
    const managedByBinaryManager = expectedPath === binaryPath;
    const source: ResolvedBinaryPath['source'] =
      binaryPath === managedPath ? 'profile-managed' : 'configured-path';

    return {
      binaryPath,
      installDir: managedByBinaryManager ? installDir : null,
      managedPath,
      managedByBinaryManager,
      source,
    };
  }

  const installDir = getProfileBinaryInstallDir(config.dataDir);
  const binaryPath = managedPath;
  return {
    binaryPath,
    installDir,
    managedPath,
    managedByBinaryManager: true,
    source: 'profile-managed',
  };
}

export function getBinaryManagerInstallDirOrThrow(resolvedBinary: ResolvedBinaryPath): string {
  if (resolvedBinary.installDir) {
    return resolvedBinary.installDir;
  }

  throw new Error(
    `Configured binaryPath "${resolvedBinary.binaryPath}" is incompatible with BinaryManager-managed path naming. ` +
      `BinaryManager expects "${new BinaryManager(dirname(resolvedBinary.binaryPath)).getBinaryPath()}". ` +
      'Set binaryPath to a standard managed name (fnn/fnn.exe) in the target directory, or unset binaryPath to use the profile-managed binary.',
  );
}

export async function getBinaryDetails(config: CliConfig): Promise<{
  resolvedBinary: ResolvedBinaryPath;
  info: BinaryInfo | ReturnType<typeof getCustomBinaryState>;
}> {
  const resolvedBinary = resolveBinaryPath(config);
  const info = resolvedBinary.installDir
    ? await getFiberBinaryInfo(resolvedBinary.installDir)
    : getCustomBinaryState(resolvedBinary.binaryPath);

  return { resolvedBinary, info };
}
