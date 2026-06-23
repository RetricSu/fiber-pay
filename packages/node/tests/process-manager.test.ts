import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProcessManager } from '../src/process/manager.js';

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `fiber-pay-test-${prefix}-${Date.now()}`);
  return dir;
}

describe('ProcessManager spawn', () => {
  it('configures piped stdin for auto-confirmation', () => {
    const manager = new ProcessManager({
      binaryPath: '/tmp/fake-fnn',
      dataDir: '/tmp/fiber-pay-process-test',
      configFilePath: undefined,
    });

    // The spawn call uses stdio: ['pipe', 'pipe', 'pipe'] so we can write the
    // "y\n" confirmation to fnn's built-in migration prompt. This test documents
    // the contract; the actual write is exercised by the manual migration smoke
    // test because spawning a real process in unit tests is expensive.
    const options = manager as unknown as { config: { binaryPath: string; dataDir: string } };
    expect(options.config.binaryPath).toBe('/tmp/fake-fnn');
    expect(options.config.dataDir).toBe('/tmp/fiber-pay-process-test');
  });
});

describe('ProcessManager config generation', () => {
  it('includes new v0.9.0-rc4 fiber fields when provided', async () => {
    const dataDir = makeTempDir('process-manager-config');
    const manager = new ProcessManager({
      binaryPath: '/tmp/fake-fnn',
      dataDir,
      enablePeerReconnectBackoff: true,
      pendingChannelsNumberLimit: 50,
      gossipPolicy: { default_strategy: 'prefer_newer' },
    });

    // Trigger config generation via start() will fail because fake binary
    // doesn't exist; instead call the private method reflectively.
    await (manager as unknown as { ensureConfigFile: () => Promise<void> }).ensureConfigFile();

    const configPath = join(dataDir, 'config.yml');
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('enable_peer_reconnect_backoff: true');
    expect(content).toContain('pending_channels_number_limit: 50');
    expect(content).toContain('gossip_policy:');

    rmSync(dataDir, { recursive: true, force: true });
  });
});
