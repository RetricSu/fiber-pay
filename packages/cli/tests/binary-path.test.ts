import { describe, expect, it } from 'vitest';
import { BinaryManager } from '@fiber-pay/node';
import { type CliConfig } from '../src/lib/config.js';
import {
  getBinaryManagerInstallDirOrThrow,
  getProfileBinaryInstallDir,
  getProfileManagedBinaryPath,
  resolveBinaryPath,
} from '../src/lib/binary-path.js';

function createConfig(overrides: Partial<CliConfig> = {}): CliConfig {
  return {
    dataDir: '/tmp/fiber-pay-profile-a',
    configPath: '/tmp/fiber-pay-profile-a/config.yml',
    network: 'testnet',
    rpcUrl: 'http://127.0.0.1:8227',
    ...overrides,
  };
}

describe('binary path resolver', () => {
  it('uses profile-managed binary path by default', () => {
    const config = createConfig();
    const resolved = resolveBinaryPath(config);

    expect(resolved.source).toBe('profile-managed');
    expect(resolved.installDir).toBe(getProfileBinaryInstallDir(config.dataDir));
    expect(resolved.binaryPath).toBe(getProfileManagedBinaryPath(config.dataDir));
  });

  it('respects configured binary path and install dir', () => {
    const customBinaryPath = '/opt/fiber/custom/fnn';
    const config = createConfig({ binaryPath: customBinaryPath });
    const resolved = resolveBinaryPath(config);

    expect(resolved.source).toBe('configured-path');
    expect(resolved.binaryPath).toBe(customBinaryPath);
    expect(resolved.installDir).toBe('/opt/fiber/custom');
    expect(resolved.managedByBinaryManager).toBe(true);
  });

  it('treats configured profile managed path as profile-managed source', () => {
    const config = createConfig();
    const managedPath = getProfileManagedBinaryPath(config.dataDir);
    const resolved = resolveBinaryPath({ ...config, binaryPath: managedPath });

    expect(resolved.source).toBe('profile-managed');
    expect(resolved.binaryPath).toBe(managedPath);
    expect(resolved.managedByBinaryManager).toBe(true);
    expect(resolved.installDir).toBe(getProfileBinaryInstallDir(config.dataDir));
  });

  it('rejects BinaryManager install-dir usage for nonstandard configured binary name', () => {
    const config = createConfig({ binaryPath: '/opt/fiber/custom/my-fnn-binary' });
    const resolved = resolveBinaryPath(config);

    expect(resolved.source).toBe('configured-path');
    expect(resolved.managedByBinaryManager).toBe(false);
    expect(resolved.installDir).toBe(null);
    expect(() => getBinaryManagerInstallDirOrThrow(resolved)).toThrow(
      'incompatible with BinaryManager-managed path naming',
    );
  });

  it('matches BinaryManager naming for managed path', () => {
    const config = createConfig();
    const installDir = getProfileBinaryInstallDir(config.dataDir);
    const expected = new BinaryManager(installDir).getBinaryPath();

    expect(getProfileManagedBinaryPath(config.dataDir)).toBe(expected);
  });
});
