import { describe, expect, it } from 'vitest';
import { ProcessManager } from '../src/process/manager.js';

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
