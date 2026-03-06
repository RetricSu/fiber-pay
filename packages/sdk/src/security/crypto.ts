/**
 * Crypto Utilities
 * Pure cryptographic functions for key operations.
 * Browser-compatible — uses Web Crypto API and @noble/hashes.
 */

import { blake2b } from '@noble/hashes/blake2.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Hash256, HashAlgorithm, HexString } from '../types/index.js';

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

/**
 * Generate a random preimage for hold invoice
 * @returns Hex-encoded random 32-byte preimage
 */
export function generatePreimage(): HexString {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${bytesToHex(bytes)}` as HexString;
}

// =============================================================================
// Payment Hash Utilities
// =============================================================================

/** CKB blake2b-256 personalization string */
const CKB_HASH_PERSONALIZATION = new Uint8Array([
  99, 107, 98, 45, 100, 101, 102, 97, 117, 108, 116, 45, 104, 97, 115, 104,
]);

/**
 * Compute CKB hash (blake2b-256 with "ckb-default-hash" personalization)
 */
export function ckbHash(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32, personalization: CKB_HASH_PERSONALIZATION });
}

/**
 * Compute SHA-256 hash
 */
export function sha256Hash(data: Uint8Array): Uint8Array {
  return sha256(data);
}

/**
 * Decode a hex string to Uint8Array (browser-compatible)
 * @param hex - Hex string (with or without 0x prefix)
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/^0x/i, '');

  if (cleanHex.length === 0) {
    return new Uint8Array(0);
  }

  if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
    throw new Error('Invalid hex string: contains non-hex characters');
  }

  if (cleanHex.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }

  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Assert that a value is never (exhaustiveness check for switch statements)
 */
function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}

/**
 * Compute payment hash from preimage using specified algorithm
 * @param preimageHex - Hex-encoded preimage (0x-prefixed)
 * @param algorithm - Hash algorithm: 'CkbHash' or 'Sha256'
 * @returns Hex-encoded payment hash (0x-prefixed, 64 hex chars)
 */
export function hashPreimage(preimageHex: HexString, algorithm: HashAlgorithm): Hash256 {
  const data = hexToBytes(preimageHex);

  let hashBytes: Uint8Array;
  switch (algorithm) {
    case 'Sha256':
      hashBytes = sha256Hash(data);
      break;
    case 'CkbHash':
      hashBytes = ckbHash(data);
      break;
    default:
      return assertNever(algorithm);
  }

  return `0x${bytesToHex(hashBytes)}` as Hash256;
}

/**
 * Verify that a preimage matches the given payment hash
 * @param preimageHex - Hex-encoded preimage
 * @param paymentHash - Expected payment hash
 * @param algorithm - Hash algorithm used
 * @returns true if preimage hashes to paymentHash
 */
export function verifyPreimageHash(
  preimageHex: HexString,
  paymentHash: Hash256,
  algorithm: HashAlgorithm,
): boolean {
  try {
    const computedHash = hashPreimage(preimageHex, algorithm);

    // Compare all bytes to reduce timing side channels for equal-length hashes.
    const computed = hexToBytes(computedHash);
    const expected = hexToBytes(paymentHash);

    if (computed.length !== expected.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < computed.length; i++) {
      result |= computed[i] ^ expected[i];
    }
    return result === 0;
  } catch {
    // Treat malformed inputs as non-matching in this boolean helper.
    return false;
  }
}
