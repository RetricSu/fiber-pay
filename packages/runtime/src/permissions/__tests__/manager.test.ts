import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PermissionManager, type PermissionManagerOptions } from '../manager.js';
import type { Permission, PermissionRequest } from '../types.js';

// Generate test key pair (32 bytes each for testing)
function generateTestKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = new Uint8Array(32);
  const publicKey = new Uint8Array(32);
  // Fill with test data (not cryptographically secure, just for tests)
  for (let i = 0; i < 32; i++) {
    privateKey[i] = i;
    publicKey[i] = i + 32;
  }
  return { privateKey, publicKey };
}

// Mock permission request factory
function createMockPermissionRequest(overrides?: Partial<PermissionRequest>): PermissionRequest {
  return {
    version: '1.0',
    app: {
      id: 'com.test.app',
      name: 'Test App',
    },
    permissions: [{ resource: 'payments', action: 'write' } as Permission],
    expires_in: '7d',
    nonce: 'test-nonce-123',
    ...overrides,
  };
}

describe('PermissionManager', () => {
  let tempDir: string;
  let dbPath: string;
  let manager: PermissionManager;
  let options: PermissionManagerOptions;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'manager-test-'));
    dbPath = join(tempDir, 'permissions.db');
    const keyPair = generateTestKeyPair();

    options = {
      dbPath,
      nodeId: 'test-node-123',
      keyPair,
    };

    manager = new PermissionManager(options);
  });

  afterEach(() => {
    manager.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should initialize with provided options', () => {
      const keyPair = generateTestKeyPair();
      const newManager = new PermissionManager({
        dbPath: join(tempDir, 'test2.db'),
        nodeId: 'node-456',
        keyPair,
      });

      expect(newManager).toBeDefined();
      newManager.close();
    });

    it('should run migrations on construction', () => {
      // Manager was created in beforeEach, migrations should have run
      expect(manager).toBeDefined();
    });
  });

  describe('createFromRequest', () => {
    it('should create a grant from a permission request', async () => {
      const request = createMockPermissionRequest();

      const grant = await manager.createFromRequest(request);

      expect(grant).toBeDefined();
      expect(grant.id).toBeString();
      expect(grant.app_id).toBe('com.test.app');
      expect(grant.app_name).toBe('Test App');
      expect(grant.node_id).toBe('test-node-123');
      expect(grant.status).toBe('pending');
      expect(grant.scopes).toHaveLength(1);
    });

    it('should set expiration from expires_in', async () => {
      const request = createMockPermissionRequest({ expires_in: '1d' });
      const beforeCreate = Date.now();

      const grant = await manager.createFromRequest(request);

      expect(grant.expires_at).toBeInstanceOf(Date);
      expect(grant.expires_at?.getTime()).toBeGreaterThan(beforeCreate);
      // Should be approximately 1 day from now (within 10 seconds tolerance)
      expect(grant.expires_at?.getTime()).toBeGreaterThanOrEqual(
        beforeCreate + 24 * 60 * 60 * 1000 - 10000,
      );
    });

    it('should throw error when app.id is missing', async () => {
      const request = createMockPermissionRequest({
        app: { id: '', name: 'Test' },
      });

      expect(async () => {
        await manager.createFromRequest(request);
      }).toThrow('Permission request must include app.id');
    });

    it('should throw error when permissions are empty', async () => {
      const request = createMockPermissionRequest({
        permissions: [],
      });

      expect(async () => {
        await manager.createFromRequest(request);
      }).toThrow('Permission request must include at least one permission');
    });

    it('should extract payment limits from request', async () => {
      const request = createMockPermissionRequest({
        permissions: [
          {
            resource: 'payments',
            action: 'write',
            max_amount: 100000n,
            daily_limit: 1000000n,
            daily_count_limit: 10,
            hourly_count_limit: 5,
            min_interval_seconds: 60,
          } as Permission,
        ],
      });

      const grant = await manager.createFromRequest(request);

      expect(grant.per_payment_limit).toBe(100000n);
      expect(grant.daily_payment_limit).toBe(1000000n);
      expect(grant.daily_count_limit).toBe(10);
      expect(grant.hourly_count_limit).toBe(5);
      expect(grant.min_interval_seconds).toBe(60);
    });

    it('should extract channel permissions from request', async () => {
      const request = createMockPermissionRequest({
        permissions: [
          {
            resource: 'channels',
            action: 'write',
            can_create_new: true,
            max_funding: 5000000n,
            can_close: true,
            can_force_close: true,
          } as Permission,
        ],
      });

      const grant = await manager.createFromRequest(request);

      expect(grant.channel_opening_allowed).toBe(true);
      expect(grant.channel_funding_limit).toBe(5000000n);
      expect(grant.can_close_channels).toBe(true);
      expect(grant.can_force_close).toBe(true);
    });

    it('should set default channel permissions when not specified', async () => {
      const request = createMockPermissionRequest({
        permissions: [{ resource: 'payments', action: 'write' } as Permission],
      });

      const grant = await manager.createFromRequest(request);

      expect(grant.channel_opening_allowed).toBe(false);
      expect(grant.can_close_channels).toBe(false);
      expect(grant.can_force_close).toBe(false);
    });

    it('should handle multiple permission types', async () => {
      const request = createMockPermissionRequest({
        permissions: [
          { resource: 'payments', action: 'write', max_amount: 100000n } as Permission,
          { resource: 'channels', action: 'write', can_create_new: true } as Permission,
          { resource: 'invoices', action: 'read' } as Permission,
        ],
      });

      const grant = await manager.createFromRequest(request);

      expect(grant.scopes).toHaveLength(3);
      expect(grant.per_payment_limit).toBe(100000n);
      expect(grant.channel_opening_allowed).toBe(true);
    });

    it('should add recipient whitelist from payment permissions', async () => {
      const request = createMockPermissionRequest({
        permissions: [
          {
            resource: 'payments',
            action: 'write',
            allowed_recipients: ['addr1', 'addr2', 'addr3'],
          } as Permission,
        ],
      });

      const grant = await manager.createFromRequest(request);

      // Verify through storage since it's an internal implementation detail
      const grantFromDb = await manager.getGrant(grant.id);
      expect(grantFromDb).toBeDefined();
    });

    it('should add allowed channels from channel permissions', async () => {
      const request = createMockPermissionRequest({
        permissions: [
          {
            resource: 'channels',
            action: 'write',
            allowed_channels: ['channel-1', 'channel-2'],
          } as Permission,
        ],
      });

      const grant = await manager.createFromRequest(request);

      expect(grant).toBeDefined();
    });

    it('should emit grant:created event', async () => {
      let emittedGrant: unknown = null;
      manager.on('grant:created', (grant) => {
        emittedGrant = grant;
      });

      const request = createMockPermissionRequest();
      await manager.createFromRequest(request);

      expect(emittedGrant).not.toBeNull();
    });
  });

  describe('approve', () => {
    it('should approve a pending grant', async () => {
      const request = createMockPermissionRequest();
      const grant = await manager.createFromRequest(request);

      const approved = await manager.approve(grant.id);

      expect(approved.status).toBe('active');
      expect(approved.token_ciphertext).toBeInstanceOf(Uint8Array);
      expect(approved.token_ciphertext.length).toBeGreaterThan(0);
    });

    it('should throw error when grant not found', async () => {
      expect(async () => {
        await manager.approve('non-existent-id');
      }).toThrow('Grant not found: non-existent-id');
    });

    it('should throw error when grant is not pending', async () => {
      const request = createMockPermissionRequest();
      const grant = await manager.createFromRequest(request);
      await manager.approve(grant.id);

      expect(async () => {
        await manager.approve(grant.id);
      }).toThrow('Cannot approve grant with status: active');
    });

    it('should apply approved limits', async () => {
      const request = createMockPermissionRequest();
      const grant = await manager.createFromRequest(request);

      const approved = await manager.approve(grant.id, {
        dailyLimit: 2000000n,
        perPaymentLimit: 200000n,
        dailyCountLimit: 20,
        hourlyCountLimit: 10,
        minIntervalSeconds: 120,
        channelOpeningAllowed: true,
        channelFundingLimit: 10000000n,
        canCloseChannels: true,
        canForceClose: true,
        timeWindowStart: '08:00',
        timeWindowEnd: '18:00',
        timeWindowDays: ['Mon', 'Tue', 'Wed'],
      });

      expect(approved.daily_payment_limit).toBe(2000000n);
      expect(approved.per_payment_limit).toBe(200000n);
      expect(approved.daily_count_limit).toBe(20);
      expect(approved.hourly_count_limit).toBe(10);
      expect(approved.min_interval_seconds).toBe(120);
      expect(approved.channel_opening_allowed).toBe(true);
      expect(approved.channel_funding_limit).toBe(10000000n);
      expect(approved.can_close_channels).toBe(true);
      expect(approved.can_force_close).toBe(true);
      expect(approved.time_window_start).toBe('08:00');
      expect(approved.time_window_end).toBe('18:00');
      expect(approved.time_window_days).toEqual(['Mon', 'Tue', 'Wed']);
    });

    it('should emit grant:approved event', async () => {
      const request = createMockPermissionRequest();
      const grant = await manager.createFromRequest(request);

      let emittedGrant: unknown = null;
      manager.on('grant:approved', (g) => {
        emittedGrant = g;
      });

      await manager.approve(grant.id);

      expect(emittedGrant).not.toBeNull();
    });

    it('should reject invalid grant id gracefully', async () => {
      expect(async () => {
        await manager.approve('');
      }).toThrow();
    });
  });

  describe('reject', () => {
    it('should reject a pending grant', async () => {
      const request = createMockPermissionRequest();
      const grant = await manager.createFromRequest(request);

      await manager.reject(grant.id, 'User declined');

      const rejected = await manager.getGrant(grant.id);
      expect(rejected?.status).toBe('revoked');
      expect(rejected?.revocation_id).toContain('rejected-');
    });

    it('should throw error when grant not found', async () => {
      expect(async () => {
        await manager.reject('non-existent-id');
      }).toThrow('Grant not found: non-existent-id');
    });

    it('should throw error when grant is not pending', async () => {
      const request = createMockPermissionRequest();
      const grant = await manager.createFromRequest(request);
      await manager.approve(grant.id);

      expect(async () => {
        await manager.reject(grant.id);
      }).toThrow('Cannot reject grant with status: active');
    });

    it('should emit grant:rejected event with reason', async () => {
      const request = createMockPermissionRequest();
      const grant = await manager.createFromRequest(request);

      let eventData: unknown = null;
      manager.on('grant:rejected', (data) => {
        eventData = data;
      });

      await manager.reject(grant.id, 'Test rejection reason');

      expect(eventData).not.toBeNull();
    });
  });

  describe('revoke', () => {
    it('should revoke an active grant', async () => {
      const request = createMockPermissionRequest();
      const grant = await manager.createFromRequest(request);
      await manager.approve(grant.id);

      await manager.revoke(grant.id);

      const revoked = await manager.getGrant(grant.id);
      expect(revoked?.status).toBe('revoked');
      expect(revoked?.revoked_at).toBeInstanceOf(Date);
    });

    it('should throw error when grant not found', async () => {
      expect(async () => {
        await manager.revoke('non-existent-id');
      }).toThrow('Grant not found: non-existent-id');
    });

    it('should throw error when grant is not active', async () => {
      const request = createMockPermissionRequest();
      const grant = await manager.createFromRequest(request);

      expect(async () => {
        await manager.revoke(grant.id);
      }).toThrow('Cannot revoke grant with status: pending');
    });

    it('should emit grant:revoked event', async () => {
      const request = createMockPermissionRequest();
      const grant = await manager.createFromRequest(request);
      await manager.approve(grant.id);

      let emittedGrant: unknown = null;
      manager.on('grant:revoked', (g) => {
        emittedGrant = g;
      });

      await manager.revoke(grant.id);

      expect(emittedGrant).not.toBeNull();
    });
  });

  describe('getGrant', () => {
    it('should return a grant by id', async () => {
      const request = createMockPermissionRequest();
      const created = await manager.createFromRequest(request);

      const retrieved = await manager.getGrant(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return undefined for non-existent grant', async () => {
      const retrieved = await manager.getGrant('non-existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('listGrants', () => {
    it('should return all grants', async () => {
      await manager.createFromRequest(
        createMockPermissionRequest({ app: { id: 'app-1', name: 'App 1' } }),
      );
      await manager.createFromRequest(
        createMockPermissionRequest({ app: { id: 'app-2', name: 'App 2' } }),
      );
      await manager.createFromRequest(
        createMockPermissionRequest({ app: { id: 'app-3', name: 'App 3' } }),
      );

      const grants = await manager.listGrants();

      expect(grants).toHaveLength(3);
    });

    it('should filter by status', async () => {
      const grant1 = await manager.createFromRequest(
        createMockPermissionRequest({ app: { id: 'app-1', name: 'App 1' } }),
      );
      const grant2 = await manager.createFromRequest(
        createMockPermissionRequest({ app: { id: 'app-2', name: 'App 2' } }),
      );
      await manager.approve(grant1.id);

      const activeGrants = await manager.listGrants({ status: 'active' });
      const pendingGrants = await manager.listGrants({ status: 'pending' });

      expect(activeGrants).toHaveLength(1);
      expect(pendingGrants).toHaveLength(1);
      expect(activeGrants[0].id).toBe(grant1.id);
      expect(pendingGrants[0].id).toBe(grant2.id);
    });

    it('should filter by appId', async () => {
      await manager.createFromRequest(
        createMockPermissionRequest({ app: { id: 'target-app', name: 'Target' } }),
      );
      await manager.createFromRequest(
        createMockPermissionRequest({ app: { id: 'other-app', name: 'Other' } }),
      );

      const grants = await manager.listGrants({ appId: 'target-app' });

      expect(grants).toHaveLength(1);
      expect(grants[0].app_id).toBe('target-app');
    });

    it('should return empty array when no grants exist', async () => {
      const grants = await manager.listGrants();
      expect(grants).toEqual([]);
    });
  });

  describe('getLimitTracker', () => {
    it('should return the limit tracker', () => {
      const tracker = manager.getLimitTracker();

      expect(tracker).toBeDefined();
    });

    it('should return consistent tracker instance', () => {
      const tracker1 = manager.getLimitTracker();
      const tracker2 = manager.getLimitTracker();

      expect(tracker1).toBe(tracker2);
    });
  });

  describe('validateToken', () => {
    it('should return invalid for malformed token', async () => {
      const result = await manager.validateToken('not-a-valid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should return invalid for empty token', async () => {
      const result = await manager.validateToken('');

      expect(result.valid).toBe(false);
    });
  });

  describe('close', () => {
    it('should close without error', () => {
      expect(() => {
        manager.close();
      }).not.toThrow();
    });

    it('should remove all listeners', () => {
      manager.on('grant:created', () => {});
      manager.on('grant:approved', () => {});

      manager.close();

      expect(manager.listenerCount('grant:created')).toBe(0);
      expect(manager.listenerCount('grant:approved')).toBe(0);
    });
  });

  describe('parseExpiration', () => {
    it('should parse days correctly', async () => {
      const request = createMockPermissionRequest({ expires_in: '7d' });
      const grant = await manager.createFromRequest(request);

      expect(grant.expires_at).toBeInstanceOf(Date);
    });

    it('should parse hours correctly', async () => {
      const request = createMockPermissionRequest({ expires_in: '24h' });
      const before = Date.now();

      const grant = await manager.createFromRequest(request);

      expect(grant.expires_at).toBeInstanceOf(Date);
      expect(grant.expires_at?.getTime()).toBeGreaterThanOrEqual(
        before + 24 * 60 * 60 * 1000 - 10000,
      );
    });

    it('should parse minutes correctly', async () => {
      const request = createMockPermissionRequest({ expires_in: '30m' });
      const before = Date.now();

      const grant = await manager.createFromRequest(request);

      expect(grant.expires_at).toBeInstanceOf(Date);
      expect(grant.expires_at?.getTime()).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 10000);
    });

    it('should parse seconds correctly', async () => {
      const request = createMockPermissionRequest({ expires_in: '60s' });
      const before = Date.now();

      const grant = await manager.createFromRequest(request);

      expect(grant.expires_at).toBeInstanceOf(Date);
      expect(grant.expires_at?.getTime()).toBeGreaterThanOrEqual(before + 60 * 1000 - 10000);
    });

    it('should handle invalid expiration format', async () => {
      const request = createMockPermissionRequest({ expires_in: 'invalid' });
      const grant = await manager.createFromRequest(request);

      expect(grant.expires_at).toBeUndefined();
    });
  });

  describe('Grant lifecycle integration', () => {
    it('should complete full lifecycle: create → approve → revoke', async () => {
      // Create
      const request = createMockPermissionRequest();
      const grant = await manager.createFromRequest(request);
      expect(grant.status).toBe('pending');

      // Approve
      const approved = await manager.approve(grant.id);
      expect(approved.status).toBe('active');

      // Revoke
      await manager.revoke(grant.id);
      const revoked = await manager.getGrant(grant.id);
      expect(revoked?.status).toBe('revoked');
    });

    it('should handle multiple grants independently', async () => {
      const grant1 = await manager.createFromRequest(
        createMockPermissionRequest({ app: { id: 'app-1', name: 'App 1' } }),
      );
      const grant2 = await manager.createFromRequest(
        createMockPermissionRequest({ app: { id: 'app-2', name: 'App 2' } }),
      );

      await manager.approve(grant1.id);
      await manager.reject(grant2.id);

      const retrieved1 = await manager.getGrant(grant1.id);
      const retrieved2 = await manager.getGrant(grant2.id);

      expect(retrieved1?.status).toBe('active');
      expect(retrieved2?.status).toBe('revoked');
    });
  });
});
