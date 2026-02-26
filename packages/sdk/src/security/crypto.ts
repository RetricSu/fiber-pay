/**
 * Crypto Utilities
 * Pure cryptographic functions for key operations.
 * Browser-compatible — uses Web Crypto API and @noble/hashes.
 */

import { scrypt } from '@noble/hashes/scrypt.js';
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

/** Magic bytes: ASCII 'FIBERENC' */
export const ENCRYPTED_MAGIC = new Uint8Array([0x46, 0x49, 0x42, 0x45, 0x52, 0x45, 0x4e, 0x43]);

// =============================================================================
// Helpers
// =============================================================================

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Copy a Uint8Array into a new one backed by its own ArrayBuffer.
 * Needed because subarray() shares the parent buffer, which breaks
 * Web Crypto APIs that expect an owned ArrayBuffer.
 */
function ownedCopy(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const dst = new Uint8Array(src.length);
  dst.set(src);
  return dst;
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Check if key data is encrypted (starts with FIBERENC magic bytes)
 */
export function isEncryptedKey(data: Uint8Array): boolean {
  if (data.length < ENCRYPTED_MAGIC.length) return false;
  for (let i = 0; i < ENCRYPTED_MAGIC.length; i++) {
    if (data[i] !== ENCRYPTED_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Decrypt an encrypted key using scrypt + AES-256-GCM
 */
export async function decryptKey(data: Uint8Array, password: string): Promise<Uint8Array> {
  let offset = ENCRYPTED_MAGIC.length;
  const salt = data.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const iv = ownedCopy(data.subarray(offset, offset + IV_LENGTH));
  offset += IV_LENGTH;
  const authTag = data.subarray(offset, offset + AUTH_TAG_LENGTH);
  offset += AUTH_TAG_LENGTH;
  const encrypted = data.subarray(offset);

  const derivedKey = ownedCopy(
    scrypt(new TextEncoder().encode(password), salt, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      dkLen: KEY_LENGTH,
    }),
  );

  const cryptoKey = await crypto.subtle.importKey('raw', derivedKey, { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);

  // Web Crypto expects ciphertext + authTag concatenated
  const ciphertext = new Uint8Array(encrypted.length + authTag.length);
  ciphertext.set(encrypted);
  ciphertext.set(authTag, encrypted.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: AUTH_TAG_LENGTH * 8 },
    cryptoKey,
    ciphertext,
  );

  return new Uint8Array(decrypted);
}

/**
 * Derive a public key hash from a private key (SHA-256)
 */
export async function derivePublicKey(privateKey: Uint8Array): Promise<HexString> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', ownedCopy(privateKey));
  return `0x${bytesToHex(new Uint8Array(hashBuffer))}` as HexString;
}

/**
 * Generate a random 32-byte private key
 */
export function generatePrivateKey(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}
