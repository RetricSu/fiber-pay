import { describe, expect, it } from 'vitest';
import * as browserEntry from '../src/browser/index.js';
import * as nodeEntry from '../src/node/index.js';
import * as rootEntry from '../src/index.js';

describe('SDK export boundaries', () => {
  it('keeps root entry free of L402 Node-only exports', () => {
    expect(rootEntry).not.toHaveProperty('createL402Middleware');
    expect(rootEntry).not.toHaveProperty('MacaroonService');
    expect(rootEntry).not.toHaveProperty('L402Middleware');
    expect(rootEntry).not.toHaveProperty('DefaultResourceResolverRegistry');
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
});
