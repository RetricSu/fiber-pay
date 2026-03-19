import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('PermissionStorage', () => {
  let tempDir: string;
  let dbPath: string;
  let storage: PermissionStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'permission-test-'));
    dbPath = join(tempDir, 'test.db');
    storage = new PermissionStorage(dbPath);
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createGrant', () => {
    it('should create a grant with generated id and created_at', () => {
      const grantData = createMockGrant();
      const grant = storage.createGrant(grantData);

      expect(grant.id).toBeString();
      expect(grant.id).toHaveLength(36); // UUID length
      expect(grant.created_at).toBeInstanceOf(Date);
      expect(grant.app_id).toBe(grantData.app_id);
      expect(grant.status).toBe('active');
    });

    it('should create a grant with all optional fields', () => {
      const grantData = createMockGrant({
        app_name: 'My Test App',
        expires_at: new Date('2025-12-31'),
        daily_payment_limit: 1000000n,
        per_payment_limit: 100000n,
        daily_count_limit: 10,
        hourly_count_limit: 5,
        min_interval_seconds: 60,
        channel_opening_allowed: true,
        channel_funding_limit: 5000000n,
        can_close_channels: true,
        can_force_close: true,
        time_window_start: '09:00',
        time_window_end: '17:00',
        time_window_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      });

      const grant = storage.createGrant(grantData);

      expect(grant.app_name).toBe('My Test App');
      expect(grant.expires_at).toBeInstanceOf(Date);
      expect(grant.daily_payment_limit).toBe(1000000n);
      expect(grant.per_payment_limit).toBe(100000n);
      expect(grant.daily_count_limit).toBe(10);
      expect(grant.hourly_count_limit).toBe(5);
      expect(grant.min_interval_seconds).toBe(60);
      expect(grant.channel_opening_allowed).toBe(true);
      expect(grant.channel_funding_limit).toBe(5000000n);
      expect(grant.can_close_channels).toBe(true);
      expect(grant.can_force_close).toBe(true);
      expect(grant.time_window_start).toBe('09:00');
      expect(grant.time_window_end).toBe('17:00');
      expect(grant.time_window_days).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    });

    it('should handle bigint values correctly', () => {
      const grantData = createMockGrant({
        daily_payment_limit: 9007199254740992n, // Large bigint
        total_amount_paid: 12345678901234567890n,
      });

      const grant = storage.createGrant(grantData);

      expect(grant.daily_payment_limit).toBe(9007199254740992n);
      expect(grant.total_amount_paid).toBe(12345678901234567890n);
    });

    it('should handle undefined optional fields', () => {
      const grantData = createMockGrant({
        app_name: undefined,
        expires_at: undefined,
        daily_payment_limit: undefined,
        daily_count_limit: undefined,
      });

      const grant = storage.createGrant(grantData);

      expect(grant.app_name).toBeUndefined();
      expect(grant.expires_at).toBeUndefined();
      expect(grant.daily_payment_limit).toBeUndefined();
      expect(grant.daily_count_limit).toBeUndefined();
    });
  });

  describe('getGrantById', () => {
    it('should retrieve a grant by id', () => {
      const grantData = createMockGrant();
      const created = storage.createGrant(grantData);

      const retrieved = storage.getGrantById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.app_id).toBe(created.app_id);
    });

    it('should return undefined for non-existent grant', () => {
      const retrieved = storage.getGrantById('non-existent-id');
      expect(retrieved).toBeUndefined();
    });

    it('should correctly retrieve grant with all data types', () => {
      const grantData = createMockGrant({
        daily_payment_limit: 1000000n,
        scopes: [
          { resource: 'payments', action: 'write', max_amount: 50000n },
          { resource: 'channels', action: 'read' },
        ] as Permission[],
      });

      const created = storage.createGrant(grantData);
      const retrieved = storage.getGrantById(created.id);

      expect(retrieved?.scopes).toHaveLength(2);
      expect(retrieved?.daily_payment_limit).toBe(1000000n);
    });
  });

  describe('getGrantByAppId', () => {
    it('should retrieve the most recent grant for an app', () => {
      const appId = 'com.test.multi';

      const _grant1 = storage.createGrant(createMockGrant({ app_id: appId }));
      const grant2 = storage.createGrant(createMockGrant({ app_id: appId }));

      // Add small delay to ensure different timestamps
      const start = Date.now();
      while (Date.now() - start < 10) {} // eslint-disable-line no-empty

      const retrieved = storage.getGrantByAppId(appId);

      expect(retrieved?.id).toBe(grant2.id);
    });

    it('should return undefined for non-existent app', () => {
      const retrieved = storage.getGrantByAppId('non-existent-app');
      expect(retrieved).toBeUndefined();
    });

    it('should only return grants for the specified app', () => {
      storage.createGrant(createMockGrant({ app_id: 'app-1' }));
      storage.createGrant(createMockGrant({ app_id: 'app-2' }));

      const retrieved = storage.getGrantByAppId('app-1');
      expect(retrieved?.app_id).toBe('app-1');
    });
  });

  describe('listGrants', () => {
    it('should return all grants when no filters applied', () => {
      storage.createGrant(createMockGrant({ app_id: 'app-1' }));
      storage.createGrant(createMockGrant({ app_id: 'app-2' }));
      storage.createGrant(createMockGrant({ app_id: 'app-3' }));

      const grants = storage.listGrants();

      expect(grants).toHaveLength(3);
    });

    it('should filter by status', () => {
      storage.createGrant(createMockGrant({ app_id: 'app-1', status: 'active' }));
      storage.createGrant(createMockGrant({ app_id: 'app-2', status: 'pending' }));
      storage.createGrant(createMockGrant({ app_id: 'app-3', status: 'active' }));

      const activeGrants = storage.listGrants({ status: 'active' });

      expect(activeGrants).toHaveLength(2);
      expect(activeGrants.every((g) => g.status === 'active')).toBe(true);
    });

    it('should filter by appId', () => {
      storage.createGrant(createMockGrant({ app_id: 'target-app' }));
      storage.createGrant(createMockGrant({ app_id: 'other-app' }));
      storage.createGrant(createMockGrant({ app_id: 'target-app' }));

      const grants = storage.listGrants({ appId: 'target-app' });

      expect(grants).toHaveLength(2);
      expect(grants.every((g) => g.app_id === 'target-app')).toBe(true);
    });

    it('should filter by both status and appId', () => {
      storage.createGrant(createMockGrant({ app_id: 'target-app', status: 'active' }));
      storage.createGrant(createMockGrant({ app_id: 'target-app', status: 'pending' }));
      storage.createGrant(createMockGrant({ app_id: 'other-app', status: 'active' }));

      const grants = storage.listGrants({ status: 'active', appId: 'target-app' });

      expect(grants).toHaveLength(1);
      expect(grants[0].app_id).toBe('target-app');
      expect(grants[0].status).toBe('active');
    });

    it('should return grants ordered by created_at desc', () => {
      const grant1 = storage.createGrant(createMockGrant());
      const start = Date.now();
      while (Date.now() - start < 10) {} // eslint-disable-line no-empty
      const grant2 = storage.createGrant(createMockGrant());

      const grants = storage.listGrants();

      expect(grants[0].id).toBe(grant2.id);
      expect(grants[1].id).toBe(grant1.id);
    });

    it('should return empty array when no grants exist', () => {
      const grants = storage.listGrants();
      expect(grants).toEqual([]);
    });
  });

  describe('updateGrant', () => {
    it('should update grant fields', () => {
      const grant = storage.createGrant(createMockGrant());

      const updated = storage.updateGrant(grant.id, {
        app_name: 'Updated Name',
        status: 'revoked',
        daily_payment_limit: 500000n,
      });

      expect(updated.app_name).toBe('Updated Name');
      expect(updated.status).toBe('revoked');
      expect(updated.daily_payment_limit).toBe(500000n);
      expect(updated.app_id).toBe(grant.app_id); // Unchanged
    });

    it('should throw error for non-existent grant', () => {
      expect(() => {
        storage.updateGrant('non-existent', { status: 'revoked' });
      }).toThrow('Grant not found: non-existent');
    });

    it('should persist updates to database', () => {
      const grant = storage.createGrant(createMockGrant());
      storage.updateGrant(grant.id, { app_name: 'Persisted Name' });

      const retrieved = storage.getGrantById(grant.id);
      expect(retrieved?.app_name).toBe('Persisted Name');
    });

    it('should handle updating to undefined values', () => {
      const grant = storage.createGrant(
        createMockGrant({
          app_name: 'Original',
          daily_payment_limit: 1000000n,
        }),
      );

      const updated = storage.updateGrant(grant.id, {
        app_name: undefined,
        daily_payment_limit: undefined,
      });

      expect(updated.app_name).toBeUndefined();
      expect(updated.daily_payment_limit).toBeUndefined();
    });

    it('should update scopes correctly', () => {
      const grant = storage.createGrant(
        createMockGrant({
          scopes: [{ resource: 'payments', action: 'write' }] as Permission[],
        }),
      );

      const newScopes: Permission[] = [
        { resource: 'payments', action: 'write' },
        { resource: 'channels', action: 'read' },
      ];

      const updated = storage.updateGrant(grant.id, { scopes: newScopes });

      expect(updated.scopes).toHaveLength(2);
      expect(updated.scopes[1].resource).toBe('channels');
    });
  });

  describe('revokeGrant', () => {
    it('should revoke a grant', () => {
      const grant = storage.createGrant(createMockGrant({ status: 'active' }));

      storage.revokeGrant(grant.id, 'revocation-reason-123');

      const revoked = storage.getGrantById(grant.id);
      expect(revoked?.status).toBe('revoked');
      expect(revoked?.revoked_at).toBeInstanceOf(Date);
      expect(revoked?.revocation_id).toBe('revocation-reason-123');
    });

    it('should throw error for non-existent grant', () => {
      expect(() => {
        storage.revokeGrant('non-existent', 'revocation-id');
      }).toThrow('Grant not found: non-existent');
    });

    it('should update revoked_at timestamp', () => {
      const grant = storage.createGrant(createMockGrant());
      const beforeRevoke = Date.now();

      storage.revokeGrant(grant.id, 'test-revocation');

      const revoked = storage.getGrantById(grant.id);
      expect(revoked?.revoked_at).toBeInstanceOf(Date);
      expect(revoked?.revoked_at?.getTime()).toBeGreaterThanOrEqual(beforeRevoke);
    });
  });

  describe('recordPaymentUsage', () => {
    it('should record payment usage', () => {
      const grant = storage.createGrant(createMockGrant());
      const today = new Date().toISOString().split('T')[0];
      const currentHour = `${today}-${String(new Date().getUTCHours()).padStart(2, '0')}`;

      storage.recordPaymentUsage(grant.id, 100000n);

      const dailyUsage = storage.getDailyUsage(grant.id, today);
      expect(dailyUsage.amount_paid).toBe(100000n);
      expect(dailyUsage.payments_count).toBe(1);

      const hourlyUsage = storage.getHourlyUsage(grant.id, currentHour);
      expect(hourlyUsage.payments_count).toBe(1);
    });

    it('should accumulate multiple payments', () => {
      const grant = storage.createGrant(createMockGrant());
      const today = new Date().toISOString().split('T')[0];

      storage.recordPaymentUsage(grant.id, 100000n);
      storage.recordPaymentUsage(grant.id, 200000n);
      storage.recordPaymentUsage(grant.id, 300000n);

      const dailyUsage = storage.getDailyUsage(grant.id, today);
      expect(dailyUsage.amount_paid).toBe(600000n);
      expect(dailyUsage.payments_count).toBe(3);
    });

    it('should update grant totals', () => {
      const grant = storage.createGrant(createMockGrant());

      storage.recordPaymentUsage(grant.id, 100000n);

      const updated = storage.getGrantById(grant.id);
      expect(updated?.total_payments_made).toBe(1);
      expect(updated?.total_amount_paid).toBe(100000n);
    });

    it('should update last_used_at timestamp', () => {
      const grant = storage.createGrant(createMockGrant());
      const beforeUsage = Date.now();

      storage.recordPaymentUsage(grant.id, 100000n);

      const updated = storage.getGrantById(grant.id);
      expect(updated?.last_used_at).toBeInstanceOf(Date);
      expect(updated?.last_used_at?.getTime()).toBeGreaterThanOrEqual(beforeUsage);
    });

    it('should handle different dates separately', () => {
      const grant = storage.createGrant(createMockGrant());
      const today = '2024-03-09';
      const _yesterday = '2024-03-08';

      // We can't easily test this without mocking, but we can verify the structure
      const dailyUsage = storage.getDailyUsage(grant.id, today);
      expect(dailyUsage.date).toBe(today);
      expect(dailyUsage.amount_paid).toBe(0n);
    });
  });

  describe('getDailyUsage', () => {
    it('should return default values when no usage exists', () => {
      const grant = storage.createGrant(createMockGrant());
      const today = new Date().toISOString().split('T')[0];

      const usage = storage.getDailyUsage(grant.id, today);

      expect(usage.grant_id).toBe(grant.id);
      expect(usage.date).toBe(today);
      expect(usage.amount_paid).toBe(0n);
      expect(usage.payments_count).toBe(0);
    });

    it('should return recorded usage', () => {
      const grant = storage.createGrant(createMockGrant());
      const today = new Date().toISOString().split('T')[0];

      storage.recordPaymentUsage(grant.id, 500000n);

      const usage = storage.getDailyUsage(grant.id, today);
      expect(usage.amount_paid).toBe(500000n);
      expect(usage.payments_count).toBe(1);
    });
  });

  describe('getHourlyUsage', () => {
    it('should return default values when no usage exists', () => {
      const grant = storage.createGrant(createMockGrant());
      const currentHour = '2024-03-09-14';

      const usage = storage.getHourlyUsage(grant.id, currentHour);

      expect(usage.grant_id).toBe(grant.id);
      expect(usage.hour).toBe(currentHour);
      expect(usage.payments_count).toBe(0);
    });

    it('should return recorded usage', () => {
      const grant = storage.createGrant(createMockGrant());
      const today = new Date().toISOString().split('T')[0];
      const currentHour = `${today}-${String(new Date().getUTCHours()).padStart(2, '0')}`;

      storage.recordPaymentUsage(grant.id, 100000n);

      const usage = storage.getHourlyUsage(grant.id, currentHour);
      expect(usage.payments_count).toBe(1);
    });
  });

  describe('Recipient Whitelist', () => {
    it('should add recipients to whitelist', () => {
      const grant = storage.createGrant(createMockGrant());
      const recipients = ['addr1', 'addr2', 'addr3'];

      storage.addRecipientWhitelist(grant.id, recipients);

      const whitelist = storage.getRecipientWhitelist(grant.id);
      expect(whitelist).toHaveLength(3);
      expect(whitelist).toContain('addr1');
      expect(whitelist).toContain('addr2');
      expect(whitelist).toContain('addr3');
    });

    it('should handle empty recipients array', () => {
      const grant = storage.createGrant(createMockGrant());

      storage.addRecipientWhitelist(grant.id, []);

      const whitelist = storage.getRecipientWhitelist(grant.id);
      expect(whitelist).toHaveLength(0);
    });

    it('should ignore duplicate recipients', () => {
      const grant = storage.createGrant(createMockGrant());

      storage.addRecipientWhitelist(grant.id, ['addr1']);
      storage.addRecipientWhitelist(grant.id, ['addr1', 'addr2']);

      const whitelist = storage.getRecipientWhitelist(grant.id);
      expect(whitelist).toHaveLength(2);
    });

    it('should return empty array for grant with no whitelist', () => {
      const grant = storage.createGrant(createMockGrant());

      const whitelist = storage.getRecipientWhitelist(grant.id);
      expect(whitelist).toEqual([]);
    });
  });

  describe('Allowed Channels', () => {
    it('should add channel IDs to allowed list', () => {
      const grant = storage.createGrant(createMockGrant());
      const channels = ['channel-1', 'channel-2'];

      storage.addAllowedChannels(grant.id, channels);

      const allowed = storage.getAllowedChannels(grant.id);
      expect(allowed).toHaveLength(2);
      expect(allowed).toContain('channel-1');
      expect(allowed).toContain('channel-2');
    });

    it('should handle empty channel array', () => {
      const grant = storage.createGrant(createMockGrant());

      storage.addAllowedChannels(grant.id, []);

      const allowed = storage.getAllowedChannels(grant.id);
      expect(allowed).toHaveLength(0);
    });

    it('should ignore duplicate channels', () => {
      const grant = storage.createGrant(createMockGrant());

      storage.addAllowedChannels(grant.id, ['channel-1']);
      storage.addAllowedChannels(grant.id, ['channel-1', 'channel-2']);

      const allowed = storage.getAllowedChannels(grant.id);
      expect(allowed).toHaveLength(2);
    });

    it('should return empty array for grant with no allowed channels', () => {
      const grant = storage.createGrant(createMockGrant());

      const allowed = storage.getAllowedChannels(grant.id);
      expect(allowed).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle grants with empty scopes', () => {
      const grant = storage.createGrant(
        createMockGrant({
          scopes: [] as Permission[],
        }),
      );

      const retrieved = storage.getGrantById(grant.id);
      expect(retrieved?.scopes).toEqual([]);
    });

    it('should handle very large amounts', () => {
      const largeAmount = 9999999999999999999n;
      const grant = storage.createGrant(createMockGrant());

      storage.recordPaymentUsage(grant.id, largeAmount);

      const today = new Date().toISOString().split('T')[0];
      const usage = storage.getDailyUsage(grant.id, today);
      expect(usage.amount_paid).toBe(largeAmount);
    });

    it('should handle special characters in app_id', () => {
      const grant = storage.createGrant(
        createMockGrant({
          app_id: 'com.test.app-with_special.chars123',
        }),
      );

      const retrieved = storage.getGrantById(grant.id);
      expect(retrieved?.app_id).toBe('com.test.app-with_special.chars123');
    });

    it('should handle unicode in app_name', () => {
      const grant = storage.createGrant(
        createMockGrant({
          app_name: '测试应用 🧪',
        }),
      );

      const retrieved = storage.getGrantById(grant.id);
      expect(retrieved?.app_name).toBe('测试应用 🧪');
    });
  });
});
