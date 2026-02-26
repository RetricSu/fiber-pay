import type { SecurityPolicy } from '@fiber-pay/sdk';
import { PolicyEngine } from '@fiber-pay/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

describe('PolicyEngine', () => {
  let policy: PolicyEngine;

  const testPolicy: SecurityPolicy = {
    name: 'test',
    version: '1.0.0',
    enabled: true,
    spending: {
      maxPerTransaction: '0x5f5e100', // 1 CKB (100,000,000 shannons)
      maxPerWindow: '0x3b9aca00', // 10 CKB
      windowSeconds: 3600,
    },
    rateLimit: {
      maxTransactions: 5,
      windowSeconds: 60,
      cooldownSeconds: 1,
    },
    recipients: {
      allowUnknown: true,
      blocklist: ['blocked-recipient'],
    },
    channels: {
      allowOpen: true,
      allowClose: true,
      allowForceClose: false,
      maxChannels: 3,
    },
    auditLogging: true,
  };

  beforeEach(() => {
    policy = new PolicyEngine(testPolicy);
  });

  describe('checkPayment', () => {
    it('should allow payment within limits', () => {
      const result = policy.checkPayment({
        amount: '0x2faf080', // 0.5 CKB
      });

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should reject payment exceeding per-transaction limit', () => {
      const result = policy.checkPayment({
        amount: '0xb2d05e00', // 30 CKB - exceeds 1 CKB limit
      });

      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.type === 'SPENDING_LIMIT_PER_TX')).toBe(true);
    });

    it('should reject payment to blocklisted recipient', () => {
      const result = policy.checkPayment({
        amount: '0x2faf080',
        recipient: 'blocked-recipient',
      });

      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.type === 'RECIPIENT_BLOCKED')).toBe(true);
    });

    it('should track spending and reject when window limit exceeded', () => {
      // First payment - should succeed
      const result1 = policy.checkPayment({ amount: '0x5f5e100' }); // 1 CKB
      expect(result1.allowed).toBe(true);
      policy.recordPayment('0x5f5e100');

      // Keep paying until we exceed window limit
      for (let i = 0; i < 9; i++) {
        policy.recordPayment('0x5f5e100');
      }

      // This should exceed the 10 CKB window limit
      const result2 = policy.checkPayment({ amount: '0x5f5e100' });
      expect(result2.allowed).toBe(false);
      expect(result2.violations.some((v) => v.type === 'SPENDING_LIMIT_PER_WINDOW')).toBe(true);
    });
  });

  describe('checkChannelOperation', () => {
    it('should allow opening channel within limits', () => {
      const result = policy.checkChannelOperation({
        operation: 'open',
        fundingAmount: '0x5f5e100',
        currentChannelCount: 1,
      });

      expect(result.allowed).toBe(true);
    });

    it('should reject opening channel when max reached', () => {
      const result = policy.checkChannelOperation({
        operation: 'open',
        currentChannelCount: 3, // Already at max
      });

      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.type === 'MAX_CHANNELS_REACHED')).toBe(true);
    });

    it('should reject force close when not allowed', () => {
      const result = policy.checkChannelOperation({
        operation: 'force_close',
      });

      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.type === 'CHANNEL_FORCE_CLOSE_NOT_ALLOWED')).toBe(
        true,
      );
    });
  });

  describe('auditLog', () => {
    it('should record audit entries', () => {
      policy.addAuditEntry('PAYMENT_SENT', true, { amount: '0x5f5e100' });
      policy.addAuditEntry('PAYMENT_SENT', true, { amount: '0x2faf080' });

      const log = policy.getAuditLog();
      expect(log).toHaveLength(2);
      expect(log[0].action).toBe('PAYMENT_SENT');
    });

    it('should filter audit log by limit', () => {
      for (let i = 0; i < 10; i++) {
        policy.addAuditEntry('PAYMENT_SENT', true, { index: i });
      }

      const log = policy.getAuditLog({ limit: 3 });
      expect(log).toHaveLength(3);
    });
  });

  describe('getRemainingAllowance', () => {
    it('should return correct remaining allowance', () => {
      policy.recordPayment('0x3b9aca00'); // 10 CKB (full window)

      const allowance = policy.getRemainingAllowance();
      expect(allowance.perWindow).toBe(0n);
    });
  });

  describe('disabled policy', () => {
    it('should allow all operations when disabled', () => {
      const disabledPolicy = new PolicyEngine({
        name: 'disabled',
        enabled: false,
      });

      const result = disabledPolicy.checkPayment({
        amount: '0xfffffffffffff', // Very large amount
        recipient: 'anyone',
      });

      expect(result.allowed).toBe(true);
    });
  });
});
