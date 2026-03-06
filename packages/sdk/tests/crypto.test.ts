import { describe, expect, it } from 'vitest';
import {
  ckbHash,
  generatePreimage,
  hashPreimage,
  sha256Hash,
  verifyPreimageHash,
} from '../src/security/crypto.js';
import type { Hash256 } from '../src/types/index.js';

describe('Payment Hash Utilities', () => {
  describe('hashPreimage', () => {
    it('should compute SHA-256 hash correctly', () => {
      // SHA-256 of "abc" (0x616263)
      const preimage = '0x616263';
      const result = hashPreimage(preimage, 'Sha256');
      expect(result).toBe('0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('should compute SHA-256 for empty preimage', () => {
      const preimage = '0x';
      const result = hashPreimage(preimage, 'Sha256');
      expect(result).toBe('0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should compute CkbHash correctly', () => {
      const preimage = '0x1234';
      const result = hashPreimage(preimage, 'CkbHash');
      // Verify format: 0x prefix + 64 hex chars
      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
      // Verify it's deterministic
      const result2 = hashPreimage(preimage, 'CkbHash');
      expect(result).toBe(result2);
    });

    it('should handle 0x prefix', () => {
      const withPrefix = '0x1234abcd';
      const withoutPrefix = '1234abcd' as const;
      const result1 = hashPreimage(withPrefix, 'Sha256');
      const result2 = hashPreimage(withoutPrefix, 'Sha256');
      expect(result1).toBe(result2);
    });

    it('should handle uppercase hex', () => {
      const lower = '0x1234abcd';
      const upper = '0x1234ABCD';
      const result1 = hashPreimage(lower, 'Sha256');
      const result2 = hashPreimage(upper, 'Sha256');
      expect(result1).toBe(result2);
    });

    it('should throw on invalid hex characters', () => {
      expect(() => hashPreimage('0xGGGG' as `0x${string}`, 'Sha256')).toThrow(
        'Invalid hex string: contains non-hex characters',
      );
    });

    it('should throw on odd length hex', () => {
      expect(() => hashPreimage('0x123', 'Sha256')).toThrow('Invalid hex string: odd length');
    });
  });

  describe('verifyPreimageHash', () => {
    it('should return true for matching hash', () => {
      const preimage = '0x1234abcd';
      const hash = hashPreimage(preimage, 'Sha256');
      expect(verifyPreimageHash(preimage, hash, 'Sha256')).toBe(true);
    });

    it('should return false for non-matching hash', () => {
      const preimage = '0x1234abcd';
      const wrongHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(verifyPreimageHash(preimage, wrongHash, 'Sha256')).toBe(false);
    });

    it('should be case-insensitive for hash', () => {
      const preimage = '0x1234abcd';
      const hash = hashPreimage(preimage, 'Sha256');
      const upperHash = hash.toUpperCase() as `0x${string}`;
      expect(verifyPreimageHash(preimage, upperHash, 'Sha256')).toBe(true);
    });

    it('should work with CkbHash algorithm', () => {
      const preimage = '0x1234abcd';
      const hash = hashPreimage(preimage, 'CkbHash');
      expect(verifyPreimageHash(preimage, hash, 'CkbHash')).toBe(true);
    });

    it('should return false for wrong algorithm', () => {
      const preimage = '0x1234abcd';
      const sha256Hash = hashPreimage(preimage, 'Sha256');
      expect(verifyPreimageHash(preimage, sha256Hash, 'CkbHash')).toBe(false);
    });

    it('should return false for malformed input hash', () => {
      const preimage = '0x1234abcd';
      expect(verifyPreimageHash(preimage, '0xGG' as Hash256, 'Sha256')).toBe(false);
    });
  });

  describe('sha256Hash', () => {
    it('should return 32 bytes', () => {
      const data = new Uint8Array([0x12, 0x34]);
      const result = sha256Hash(data);
      expect(result.length).toBe(32);
    });

    it('should be deterministic', () => {
      const data = new Uint8Array([0x12, 0x34]);
      const result1 = sha256Hash(data);
      const result2 = sha256Hash(data);
      expect(result1).toEqual(result2);
    });
  });

  describe('ckbHash', () => {
    it('should return 32 bytes', () => {
      const data = new Uint8Array([0x12, 0x34]);
      const result = ckbHash(data);
      expect(result.length).toBe(32);
    });

    it('should be deterministic', () => {
      const data = new Uint8Array([0x12, 0x34]);
      const result1 = ckbHash(data);
      const result2 = ckbHash(data);
      expect(result1).toEqual(result2);
    });

    it('should differ from sha256Hash', () => {
      const data = new Uint8Array([0x12, 0x34]);
      const ckb = ckbHash(data);
      const sha = sha256Hash(data);
      expect(ckb).not.toEqual(sha);
    });
  });

  describe('generatePreimage', () => {
    it('should generate 32-byte preimage (66 chars with 0x)', () => {
      const preimage = generatePreimage();
      expect(preimage).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(preimage.length).toBe(66);
    });

    it('should generate unique values', () => {
      const p1 = generatePreimage();
      const p2 = generatePreimage();
      expect(p1).not.toBe(p2);
    });

    it('should generate valid hex', () => {
      const preimage = generatePreimage();
      expect(() => hashPreimage(preimage, 'Sha256')).not.toThrow();
    });
  });

  describe('Integration: complete workflow', () => {
    it('should work with Sha256: generate -> hash -> verify', () => {
      const preimage = generatePreimage();
      const hash = hashPreimage(preimage, 'Sha256');
      const isValid = verifyPreimageHash(preimage, hash, 'Sha256');
      expect(isValid).toBe(true);
    });

    it('should work with CkbHash: generate -> hash -> verify', () => {
      const preimage = generatePreimage();
      const hash = hashPreimage(preimage, 'CkbHash');
      const isValid = verifyPreimageHash(preimage, hash, 'CkbHash');
      expect(isValid).toBe(true);
    });

    it('should detect tampered preimage', () => {
      const preimage = generatePreimage();
      const hash = hashPreimage(preimage, 'Sha256');
      const tamperedPreimage = (preimage.slice(0, -1) +
        (preimage.slice(-1) === '0' ? '1' : '0')) as `0x${string}`;
      const isValid = verifyPreimageHash(tamperedPreimage, hash, 'Sha256');
      expect(isValid).toBe(false);
    });
  });
});
