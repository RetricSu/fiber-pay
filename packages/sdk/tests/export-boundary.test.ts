import { describe, expect, it } from 'vitest';
import * as browserEntry from '@fiber-pay/sdk/browser';
import * as nodeEntry from '@fiber-pay/sdk/node';
import * as rootEntry from '@fiber-pay/sdk';

describe('SDK export boundaries', () => {
  it('keeps root and browser entries free of L402 Node-only exports', () => {
    expect(rootEntry).not.toHaveProperty('createL402Middleware');
    expect(rootEntry).not.toHaveProperty('MacaroonService');
    expect(rootEntry).not.toHaveProperty('L402Middleware');
    expect(rootEntry).not.toHaveProperty('DefaultResourceResolverRegistry');

    expect(browserEntry).not.toHaveProperty('createL402Middleware');
    expect(browserEntry).not.toHaveProperty('MacaroonService');
    expect(browserEntry).not.toHaveProperty('L402Middleware');
    expect(browserEntry).not.toHaveProperty('DefaultResourceResolverRegistry');
  });

  it('exposes L402 server APIs from node entry', () => {
    expect(nodeEntry).toHaveProperty('createL402Middleware');
    expect(nodeEntry).toHaveProperty('MacaroonService');
    expect(nodeEntry).toHaveProperty('L402Middleware');
    expect(nodeEntry).toHaveProperty('DefaultResourceResolverRegistry');
  });

  it('keeps core RPC client available across entries', () => {
    expect(rootEntry).toHaveProperty('FiberRpcClient');
    expect(nodeEntry).toHaveProperty('FiberRpcClient');
    expect(browserEntry).toHaveProperty('FiberRpcClient');
  });

  it('exposes channel state normalization helpers from root, browser, and node entries', () => {
    for (const entry of [rootEntry, browserEntry, nodeEntry]) {
      expect(entry).toHaveProperty('normalizeChannel');
      expect(entry).toHaveProperty('normalizeChannelStateName');
      expect(typeof (entry as Record<string, unknown>).normalizeChannel).toBe('function');
      expect(typeof (entry as Record<string, unknown>).normalizeChannelStateName).toBe('function');
    }
  });
});
