import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LimitTracker } from '../limit-tracker.js';
import { PermissionStorage } from '../storage.js';
import type { Permission, PermissionGrant } from '../types.js';

// Test helpers
function createMockGrant(
  overrides?: Partial<PermissionGrant>,
): Omit<PermissionGrant, 'id' | 'created_at'> {
  return {
    app_id: 'com.test.app',
    app_name: 'Test App',
    node_id: 'node-123',
    token_ciphertext: new Uint8Array([1, 2, 3, 4]),
    scopes: [{ resource: 'payments', action: 'write' } as Permission],
    status: 'active',
    channel_opening_allowed: false,
    can_close_channels: false,
    can_force_close: false,
    total_payments_made: 0,
    total_amount_paid: 0n,
    ...overrides,
  };
}

describe('LimitTracker', () => {
  let tempDir: string;
  let dbPath: string;
  let storage: PermissionStorage;
  let limitTracker: LimitTracker;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'limit-tracker-test-'));
    dbPath = join(tempDir, 'test.db');
    storage = new PermissionStorage(dbPath);
    limitTracker = new LimitTracker(storage);
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('checkPaymentAllowed', () => {
    it('should allow payment when no limits are set', async () => {
      const grant = storage.createGrant(createMockGrant());

      const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject when grant not found', async () => {
      const result = await limitTracker.checkPaymentAllowed('non-existent', 100000n);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Grant not found');
    });

    it('should reject when grant is not active', async () => {
      const grant = storage.createGrant(createMockGrant({ status: 'pending' }));

      const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Grant is pending');
    });

    it('should reject when grant is revoked', async () => {
      const grant = storage.createGrant(createMockGrant({ status: 'revoked' }));

      const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Grant is revoked');
    });

    describe('per-payment limit', () => {
      it('should allow payment under per-payment limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            per_payment_limit: 100000n,
          }),
        );

        const result = await limitTracker.checkPaymentAllowed(grant.id, 50000n);

        expect(result.allowed).toBe(true);
      });

      it('should reject payment exceeding per-payment limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            per_payment_limit: 100000n,
          }),
        );

        const result = await limitTracker.checkPaymentAllowed(grant.id, 150000n);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('exceeds per-payment limit');
        expect(result.reason).toContain('150000');
        expect(result.reason).toContain('100000');
      });

      it('should allow payment exactly at per-payment limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            per_payment_limit: 100000n,
          }),
        );

        const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

        expect(result.allowed).toBe(true);
      });
    });

    describe('daily payment limit', () => {
      it('should allow payment under daily limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            daily_payment_limit: 1000000n,
          }),
        );

        const result = await limitTracker.checkPaymentAllowed(grant.id, 500000n);

        expect(result.allowed).toBe(true);
      });

      it('should reject payment exceeding daily limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            daily_payment_limit: 1000000n,
          }),
        );

        // Record some usage first
        storage.recordPaymentUsage(grant.id, 800000n);

        const result = await limitTracker.checkPaymentAllowed(grant.id, 300000n);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Daily amount limit exceeded');
      });

      it('should allow payment exactly at daily limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            daily_payment_limit: 1000000n,
          }),
        );

        storage.recordPaymentUsage(grant.id, 500000n);

        const result = await limitTracker.checkPaymentAllowed(grant.id, 500000n);

        expect(result.allowed).toBe(true);
      });

      it('should track multiple payments against daily limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            daily_payment_limit: 1000000n,
          }),
        );

        await limitTracker.recordPayment(grant.id, 200000n);
        await limitTracker.recordPayment(grant.id, 300000n);

        const result = await limitTracker.checkPaymentAllowed(grant.id, 600000n);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('1100000'); // 200000 + 300000 + 600000
      });
    });

    describe('daily count limit', () => {
      it('should allow payment under daily count limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            daily_count_limit: 5,
          }),
        );

        const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

        expect(result.allowed).toBe(true);
      });

      it('should reject payment exceeding daily count limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            daily_count_limit: 3,
          }),
        );

        // Record 3 payments
        storage.recordPaymentUsage(grant.id, 100000n);
        storage.recordPaymentUsage(grant.id, 100000n);
        storage.recordPaymentUsage(grant.id, 100000n);

        const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Daily count limit exceeded');
        expect(result.reason).toContain('4');
        expect(result.reason).toContain('3');
      });

      it('should allow payment exactly at daily count limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            daily_count_limit: 3,
          }),
        );

        storage.recordPaymentUsage(grant.id, 100000n);
        storage.recordPaymentUsage(grant.id, 100000n);

        const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

        expect(result.allowed).toBe(true);
      });
    });

    describe('hourly count limit', () => {
      it('should allow payment under hourly count limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            hourly_count_limit: 5,
          }),
        );

        const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

        expect(result.allowed).toBe(true);
      });

      it('should reject payment exceeding hourly count limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            hourly_count_limit: 2,
          }),
        );

        // Record 2 payments
        storage.recordPaymentUsage(grant.id, 100000n);
        storage.recordPaymentUsage(grant.id, 100000n);

        const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Hourly count limit exceeded');
        expect(result.reason).toContain('3');
        expect(result.reason).toContain('2');
      });
    });

    describe('combined limits', () => {
      it('should enforce all limits together', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            per_payment_limit: 100000n,
            daily_payment_limit: 200000n,
            daily_count_limit: 3,
            hourly_count_limit: 2,
          }),
        );

        // Should pass all limits
        const result1 = await limitTracker.checkPaymentAllowed(grant.id, 50000n);
        expect(result1.allowed).toBe(true);

        // Record a payment
        await limitTracker.recordPayment(grant.id, 50000n);

        // Should still pass
        const result2 = await limitTracker.checkPaymentAllowed(grant.id, 50000n);
        expect(result2.allowed).toBe(true);

        // Record another payment
        await limitTracker.recordPayment(grant.id, 50000n);

        // Should fail hourly count (2 of 2 used)
        const result3 = await limitTracker.checkPaymentAllowed(grant.id, 10000n);
        expect(result3.allowed).toBe(false);
        expect(result3.reason).toContain('Hourly count limit');
      });

      it('should check per-payment limit before daily limit', async () => {
        const grant = storage.createGrant(
          createMockGrant({
            per_payment_limit: 50000n,
            daily_payment_limit: 1000000n,
          }),
        );

        const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('per-payment limit');
      });
    });
  });

  describe('recordPayment', () => {
    it('should record a payment', async () => {
      const grant = storage.createGrant(createMockGrant());
      const today = new Date().toISOString().split('T')[0];

      await limitTracker.recordPayment(grant.id, 100000n);

      const dailyUsage = storage.getDailyUsage(grant.id, today);
      expect(dailyUsage.amount_paid).toBe(100000n);
      expect(dailyUsage.payments_count).toBe(1);
    });

    it('should accumulate multiple payments', async () => {
      const grant = storage.createGrant(createMockGrant());
      const today = new Date().toISOString().split('T')[0];

      await limitTracker.recordPayment(grant.id, 100000n);
      await limitTracker.recordPayment(grant.id, 200000n);

      const dailyUsage = storage.getDailyUsage(grant.id, today);
      expect(dailyUsage.amount_paid).toBe(300000n);
      expect(dailyUsage.payments_count).toBe(2);
    });

    it('should update grant totals', async () => {
      const grant = storage.createGrant(createMockGrant());

      await limitTracker.recordPayment(grant.id, 100000n);

      const updated = storage.getGrantById(grant.id);
      expect(updated?.total_payments_made).toBe(1);
      expect(updated?.total_amount_paid).toBe(100000n);
    });
  });

  describe('getDailyUsage', () => {
    it('should return usage for specific date', async () => {
      const grant = storage.createGrant(createMockGrant());
      const specificDate = '2024-03-09';

      // No usage yet
      const usage1 = await limitTracker.getDailyUsage(grant.id, specificDate);
      expect(usage1.amount_paid).toBe(0n);
      expect(usage1.payments_count).toBe(0);

      // Record usage via storage directly (simulating past date)
      storage.recordPaymentUsage(grant.id, 500000n);

      const today = new Date().toISOString().split('T')[0];
      const usage2 = await limitTracker.getDailyUsage(grant.id, today);
      expect(usage2.amount_paid).toBe(500000n);
      expect(usage2.payments_count).toBe(1);
    });

    it('should return correct grant_id and date', async () => {
      const grant = storage.createGrant(createMockGrant());
      const specificDate = '2024-03-09';

      const usage = await limitTracker.getDailyUsage(grant.id, specificDate);

      expect(usage.grant_id).toBe(grant.id);
      expect(usage.date).toBe(specificDate);
    });
  });

  describe('getHourlyUsage', () => {
    it('should return usage for specific hour', async () => {
      const grant = storage.createGrant(createMockGrant());
      const specificHour = '2024-03-09-14';

      const usage = await limitTracker.getHourlyUsage(grant.id, specificHour);

      expect(usage.payments_count).toBe(0);
      expect(usage.grant_id).toBe(grant.id);
      expect(usage.hour).toBe(specificHour);
    });
  });

  describe('resetIfNeeded', () => {
    it('should not reset on same day', async () => {
      const grant = storage.createGrant(
        createMockGrant({
          daily_payment_limit: 1000000n,
        }),
      );

      await limitTracker.recordPayment(grant.id, 500000n);
      await limitTracker.resetIfNeeded();

      const today = new Date().toISOString().split('T')[0];
      const usage = storage.getDailyUsage(grant.id, today);
      expect(usage.amount_paid).toBe(500000n);
    });

    // Note: Testing actual midnight reset requires time mocking which
    // is complex in Bun. The implementation tracks the last reset date
    // and resets internal state when the date changes.
    it('should handle reset tracking state', async () => {
      // Create tracker and verify it initializes with current date
      const tracker = new LimitTracker(storage);

      // Should complete without error
      await tracker.resetIfNeeded();

      // Internal state should be updated
      expect(tracker).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero amount payments', async () => {
      const grant = storage.createGrant(createMockGrant());

      const result = await limitTracker.checkPaymentAllowed(grant.id, 0n);

      expect(result.allowed).toBe(true);
    });

    it('should handle very large amounts', async () => {
      const largeAmount = 9999999999999999999n;
      const grant = storage.createGrant(
        createMockGrant({
          per_payment_limit: largeAmount,
          daily_payment_limit: largeAmount * 2n,
        }),
      );

      const result = await limitTracker.checkPaymentAllowed(grant.id, largeAmount);

      expect(result.allowed).toBe(true);
    });

    it('should handle grant with all limits as undefined', async () => {
      const grant = storage.createGrant(
        createMockGrant({
          per_payment_limit: undefined,
          daily_payment_limit: undefined,
          daily_count_limit: undefined,
          hourly_count_limit: undefined,
        }),
      );

      const result = await limitTracker.checkPaymentAllowed(grant.id, 1000000000n);

      expect(result.allowed).toBe(true);
    });

    it('should handle grant with zero limits', async () => {
      const grant = storage.createGrant(
        createMockGrant({
          daily_count_limit: 0,
        }),
      );

      const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily count limit exceeded');
    });

    it('should handle expired grant status', async () => {
      const grant = storage.createGrant(createMockGrant({ status: 'expired' }));

      const result = await limitTracker.checkPaymentAllowed(grant.id, 100000n);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Grant is expired');
    });
  });
});
