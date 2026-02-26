/**
 * Crypto Utilities
 * Pure cryptographic functions for key operations.
 * No file I/O — safe to use in any environment that supports node:crypto.
 */

import { createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import type { HexString } from '../types/index.js';

// =============================================================================
// Constants
// =============================================================================

export const SCRYPT_N = 2 ** 14;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const KEY_LENGTH = 32;
export const SALT_LENGTH = 32;
export const IV_LENGTH = 16;
export const AUTH_TAG_LENGTH = 16;
export const ENCRYPTED_MAGIC = Buffer.from('FIBERENC');

// =============================================================================
// Functions
// =============================================================================

/**
 * Check if key data is encrypted (starts with FIBERENC magic bytes)
 */
export function isEncryptedKey(data: Buffer): boolean {
  return (
    data.length >= ENCRYPTED_MAGIC.length &&
    data.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC)
  );
}

/**
 * Decrypt an encrypted key using scrypt + AES-256-GCM
 */
export function decryptKey(data: Buffer, password: string): Buffer {
  let offset = ENCRYPTED_MAGIC.length;
  const salt = data.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const iv = data.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;
  const authTag = data.subarray(offset, offset + AUTH_TAG_LENGTH);
  offset += AUTH_TAG_LENGTH;
  const encrypted = data.subarray(offset);

  const derivedKey = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Derive a public key hash from a private key (SHA-256)
 */
export function derivePublicKey(privateKey: Buffer): HexString {
  const hash = createHash('sha256').update(privateKey).digest();
  return `0x${hash.toString('hex')}` as HexString;
}

/**
 * Generate a random 32-byte private key
 */
export function generatePrivateKey(): Buffer {
  return randomBytes(32);
}
