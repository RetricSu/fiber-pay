import { afterEach, describe, expect, it } from 'vitest';
import { getEffectiveConfig } from '../src/lib/config.js';

const ORIGINAL_ENV = { ...process.env };

describe('auth token config resolution', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('loads rpc biscuit token from env by default', () => {
    process.env.FIBER_DATA_DIR = '/tmp/fiber-pay-test-auth';
    process.env.FIBER_RPC_BISCUIT_TOKEN = 'env-token';

    const effective = getEffectiveConfig();

    expect(effective.config.rpcBiscuitToken).toBe('env-token');
    expect(effective.sources.rpcBiscuitToken).toBe('env');
  });

  it('marks rpc biscuit token source as cli when explicitly overridden', () => {
    process.env.FIBER_DATA_DIR = '/tmp/fiber-pay-test-auth';
    process.env.FIBER_RPC_BISCUIT_TOKEN = 'cli-token';

    const effective = getEffectiveConfig(new Set(['rpcBiscuitToken']));

    expect(effective.config.rpcBiscuitToken).toBe('cli-token');
    expect(effective.sources.rpcBiscuitToken).toBe('cli');
  });

  it('keeps rpc biscuit token unset when not provided', () => {
    process.env.FIBER_DATA_DIR = '/tmp/fiber-pay-test-auth';
    delete process.env.FIBER_RPC_BISCUIT_TOKEN;

    const effective = getEffectiveConfig();

    expect(effective.config.rpcBiscuitToken).toBeUndefined();
    expect(effective.sources.rpcBiscuitToken).toBe('unset');
  });
});
