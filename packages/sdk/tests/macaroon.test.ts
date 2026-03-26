import { createHash } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MacaroonService } from '../src/l402/macaroon.js';

// 32-byte hex key for testing
const TEST_ROOT_KEY = 'a'.repeat(64);

describe('MacaroonService', () => {
  let service: MacaroonService;

  beforeEach(() => {
    service = new MacaroonService(TEST_ROOT_KEY);
  });

  describe('constructor', () => {
    it('should accept a valid 32-byte hex root key', () => {
      expect(() => new MacaroonService(TEST_ROOT_KEY)).not.toThrow();
    });

    it('should accept 0x-prefixed root key', () => {
      expect(() => new MacaroonService(`0x${TEST_ROOT_KEY}`)).not.toThrow();
    });

    it('should reject keys that are not 32 bytes', () => {
      expect(() => new MacaroonService('abcd')).toThrow('Root key must be 32 bytes');
    });

    it('should generate a random key if none provided and env not set', () => {
      const original = process.env.L402_ROOT_KEY;
      delete process.env.L402_ROOT_KEY;
      expect(() => new MacaroonService()).not.toThrow();
      process.env.L402_ROOT_KEY = original;
    });
  });

  describe('mint', () => {
    it('should return a base64-encoded macaroon and caveats', () => {
      const result = service.mint({
        identifier: 'test-1',
        paymentHash: '0x' + '1'.repeat(64),
        expirySeconds: 3600,
      });

      expect(result.macaroon).toBeTruthy();
      expect(typeof result.macaroon).toBe('string');
      // Should be valid base64
      expect(() => Buffer.from(result.macaroon, 'base64')).not.toThrow();

      expect(result.caveats).toHaveLength(2);
      expect(result.caveats[0]).toEqual({
        condition: 'payment_hash',
        value: '0x' + '1'.repeat(64),
      });
      expect(result.caveats[1].condition).toBe('expiry');
    });

    it('should include resource caveats when provided', () => {
      const result = service.mint({
        identifier: 'test-2',
        paymentHash: '0x' + '2'.repeat(64),
        resourceId: 'article-42',
        resourceType: 'article',
      });

      expect(result.caveats).toHaveLength(4);
      expect(result.caveats[2]).toEqual({ condition: 'resource_id', value: 'article-42' });
      expect(result.caveats[3]).toEqual({ condition: 'resource_type', value: 'article' });
    });
  });

  describe('verify', () => {
    it('should verify a valid macaroon + preimage pair', () => {
      // Generate a preimage and compute its payment hash
      const preimage = Buffer.from('0'.repeat(64), 'hex');
      const paymentHash =
        '0x' + createHash('sha256').update(preimage).digest('hex');

      const { macaroon } = service.mint({
        identifier: 'verify-test',
        paymentHash,
        expirySeconds: 3600,
      });

      const result = service.verify(macaroon, preimage.toString('hex'));

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.caveats).toBeDefined();
      expect(result.caveats!.payment_hash).toBe(paymentHash);
    });

    it('should reject an invalid preimage', () => {
      const paymentHash = '0x' + '1'.repeat(64);
      const { macaroon } = service.mint({
        identifier: 'bad-preimage',
        paymentHash,
        expirySeconds: 3600,
      });

      const result = service.verify(macaroon, '2'.repeat(64));

      expect(result.valid).toBe(false);
      expect(result.error).toContain('hash mismatch');
    });

    it('should reject an expired macaroon', () => {
      const preimage = Buffer.from('0'.repeat(64), 'hex');
      const paymentHash =
        '0x' + createHash('sha256').update(preimage).digest('hex');

      const { macaroon } = service.mint({
        identifier: 'expired-test',
        paymentHash,
        expirySeconds: -1, // Already expired
      });

      const result = service.verify(macaroon, preimage.toString('hex'));

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should reject a macaroon signed with a different key', () => {
      const preimage = Buffer.from('0'.repeat(64), 'hex');
      const paymentHash =
        '0x' + createHash('sha256').update(preimage).digest('hex');

      const otherService = new MacaroonService('b'.repeat(64));
      const { macaroon } = otherService.mint({
        identifier: 'wrong-key',
        paymentHash,
        expirySeconds: 3600,
      });

      const result = service.verify(macaroon, preimage.toString('hex'));

      expect(result.valid).toBe(false);
    });
  });

  describe('verifyWithoutPreimage', () => {
    it('should verify macaroon signature and caveats without preimage', () => {
      const { macaroon } = service.mint({
        identifier: 'no-preimage',
        paymentHash: '0x' + '1'.repeat(64),
        expirySeconds: 3600,
      });

      const result = service.verifyWithoutPreimage(macaroon);

      expect(result.valid).toBe(true);
      expect(result.caveats!.payment_hash).toBe('0x' + '1'.repeat(64));
    });

    it('should reject an expired macaroon', () => {
      const { macaroon } = service.mint({
        identifier: 'expired-no-preimage',
        paymentHash: '0x' + '1'.repeat(64),
        expirySeconds: -1,
      });

      const result = service.verifyWithoutPreimage(macaroon);

      expect(result.valid).toBe(false);
    });
  });

  describe('extractCaveats', () => {
    it('should extract all caveats from a macaroon', () => {
      const { macaroon } = service.mint({
        identifier: 'extract-test',
        paymentHash: '0xabc123',
        resourceId: 'res-1',
        resourceType: 'data',
        expirySeconds: 7200,
      });

      const caveats = service.extractCaveats(macaroon);

      expect(caveats.payment_hash).toBe('0xabc123');
      expect(caveats.resource_id).toBe('res-1');
      expect(caveats.resource_type).toBe('data');
      expect(caveats.expiry).toBeDefined();
    });

    it('should return empty object for invalid input', () => {
      const caveats = service.extractCaveats('not-a-macaroon');
      expect(caveats).toEqual({});
    });
  });
});
