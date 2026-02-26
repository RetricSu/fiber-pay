import { describe, expect, it } from 'vitest';
import { classifyRpcError } from '../src/jobs/error-classifier.js';

describe('classifyRpcError', () => {
  it('classifies no_route errors', () => {
    const r = classifyRpcError(new Error('no path found'));
    expect(r.category).toBe('no_route');
    expect(r.retryable).toBe(true);
  });

  it('classifies from Fiber failed_error string (no_route)', () => {
    const r = classifyRpcError(undefined, 'Route not found for payment');
    expect(r.category).toBe('no_route');
    expect(r.retryable).toBe(true);
  });

  it('classifies insufficient_balance', () => {
    const r = classifyRpcError(new Error('insufficient balance'));
    expect(r.category).toBe('insufficient_balance');
    expect(r.retryable).toBe(false);
  });

  it('classifies invoice_expired', () => {
    const r = classifyRpcError(undefined, 'Invoice expired');
    expect(r.category).toBe('invoice_expired');
    expect(r.retryable).toBe(false);
  });

  it('classifies peer_offline', () => {
    const r = classifyRpcError(new Error('peer offline'));
    expect(r.category).toBe('peer_offline');
    expect(r.retryable).toBe(true);
  });

  it('classifies peer init handshake race as retryable peer_offline', () => {
    const r = classifyRpcError(
      new Error(
        "Invalid parameter: Peer PeerId(QmFoo)'s feature not found, waiting for peer to send Init message",
      ),
    );
    expect(r.category).toBe('peer_offline');
    expect(r.retryable).toBe(true);
  });

  it('classifies timeout', () => {
    const r = classifyRpcError(new Error('Request timed out'));
    expect(r.category).toBe('timeout');
    expect(r.retryable).toBe(true);
  });

  it('classifies fetch failed as retryable peer_offline', () => {
    const r = classifyRpcError(new Error('fetch failed'));
    expect(r.category).toBe('peer_offline');
    expect(r.retryable).toBe(true);
  });

  it('classifies duplicated payment hash as non-retryable invalid_payment', () => {
    const r = classifyRpcError(new Error('payment hash already exists'));
    expect(r.category).toBe('invalid_payment');
    expect(r.retryable).toBe(false);
  });

  it('classifies duplicated channel as retryable temporary_failure', () => {
    const r = classifyRpcError(new Error('channel already exists for peer'));
    expect(r.category).toBe('temporary_failure');
    expect(r.retryable).toBe(true);
  });

  it('falls back to unknown for unrecognized errors', () => {
    const r = classifyRpcError(new Error('something completely unexpected'));
    expect(r.category).toBe('unknown');
    expect(r.retryable).toBe(false);
  });

  it('prefers failed_error string over thrown error message', () => {
    const r = classifyRpcError(new Error('some rpc error'), 'Invoice expired');
    expect(r.category).toBe('invoice_expired');
  });

  it('handles non-Error thrown values', () => {
    const r = classifyRpcError('timeout');
    expect(r.category).toBe('timeout');
    expect(r.retryable).toBe(true);
  });
});
