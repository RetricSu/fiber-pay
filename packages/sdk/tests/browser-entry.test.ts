import { describe, it, expect } from 'vitest';
import * as browserSdk from '../src/browser.js';

describe('@fiber-pay/sdk/browser entry', () => {
  it('should expose browser-safe exports', () => {
    expect(typeof browserSdk.FiberRpcClient).toBe('function');
    expect(typeof browserSdk.FiberRpcError).toBe('function');
    expect(typeof browserSdk.toHex).toBe('function');
    expect(typeof browserSdk.fromHex).toBe('function');
    expect(typeof browserSdk.ckbToShannons).toBe('function');
    expect(typeof browserSdk.shannonsToCkb).toBe('function');
    expect(typeof browserSdk.nodeIdToPeerId).toBe('function');
    expect(typeof browserSdk.buildMultiaddr).toBe('function');
    expect(typeof browserSdk.buildMultiaddrFromNodeId).toBe('function');
    expect(typeof browserSdk.randomBytes32).toBe('function');
    expect(typeof browserSdk.scriptToAddress).toBe('function');
  });

  it('should not expose node-only exports', () => {
    expect('KeyManager' in browserSdk).toBe(false);
    expect('createKeyManager' in browserSdk).toBe(false);
    expect('CorsProxy' in browserSdk).toBe(false);
    expect('PaymentProofManager' in browserSdk).toBe(false);
    expect('InvoiceVerifier' in browserSdk).toBe(false);
  });
});
