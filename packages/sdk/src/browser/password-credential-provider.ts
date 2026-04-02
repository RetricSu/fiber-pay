/**
 * PasswordCredentialProvider
 *
 * Derives Fiber and CKB keys from a user-supplied password using scrypt.
 * Once unlocked, keys are cached in memory for the session — no per-operation
 * user interaction is required.
 *
 * Key derivation scheme:
 *   password + salt → scrypt → 64 bytes
 *     [0..32]  = Fiber key pair (P2P identity)
 *     [32..64] = CKB secret key (on-chain signing)
 *
 * The salt is persisted to IndexedDB so the same password always produces
 * the same keys on the same device. A new salt is generated on first use.
 */

import { scrypt } from '@noble/hashes/scrypt.js';
import type { CredentialProvider, PasswordUnlockParams } from './credential-provider.js';

// =============================================================================
// Constants
// =============================================================================

const SCRYPT_N = 2 ** 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const DERIVED_KEY_LENGTH = 64; // 32 for fiber + 32 for ckb
const SALT_LENGTH = 32;
const IDB_STORE_NAME = 'fiber-pay-credentials';

// =============================================================================
// IndexedDB Helpers (browser-only storage for salt)
// =============================================================================

function openSaltDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_STORE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('salts');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getSalt(identifier: string): Promise<Uint8Array | null> {
  const db = await openSaltDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('salts', 'readonly');
    const store = tx.objectStore('salts');
    const request = store.get(identifier);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function saveSalt(identifier: string, salt: Uint8Array): Promise<void> {
  const db = await openSaltDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('salts', 'readwrite');
    const store = tx.objectStore('salts');
    store.put(salt, identifier);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// =============================================================================
// Implementation
// =============================================================================

export class PasswordCredentialProvider implements CredentialProvider {
  private fiberKey: Uint8Array | null = null;
  private ckbKey: Uint8Array | null = null;
  private identifier: string;
  private skipCkbKey: boolean;

  /**
   * @param identifier - Unique identity string (e.g. user email or wallet name).
   *   Used for IndexedDB salt isolation and WASM database prefix.
   * @param options.skipCkbKey - If true, getCkbSecretKey() returns undefined.
   *   Useful for external funding mode where CKB signing is handled externally.
   */
  constructor(identifier: string, options?: { skipCkbKey?: boolean }) {
    this.identifier = identifier;
    this.skipCkbKey = options?.skipCkbKey ?? false;
  }

  async getFiberKeyPair(): Promise<Uint8Array> {
    if (!this.fiberKey) {
      throw new Error('CredentialProvider is locked. Call unlock() first.');
    }
    return this.fiberKey;
  }

  async getCkbSecretKey(): Promise<Uint8Array | undefined> {
    if (!this.isUnlocked()) {
      throw new Error('CredentialProvider is locked. Call unlock() first.');
    }
    return this.ckbKey ?? undefined;
  }

  async unlock(params?: PasswordUnlockParams): Promise<void> {
    if (!params?.password) {
      throw new Error('Password is required to unlock PasswordCredentialProvider.');
    }

    // Get or create salt
    let salt = await getSalt(this.identifier);
    if (!salt) {
      const newSalt = new Uint8Array(SALT_LENGTH);
      crypto.getRandomValues(newSalt);
      salt = newSalt;
      await saveSalt(this.identifier, salt);
    }

    // Derive keys
    const derived = scrypt(new TextEncoder().encode(params.password), salt, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      dkLen: DERIVED_KEY_LENGTH,
    });

    this.fiberKey = new Uint8Array(derived.buffer, derived.byteOffset, 32);

    if (!this.skipCkbKey) {
      this.ckbKey = new Uint8Array(derived.buffer, derived.byteOffset + 32, 32);
    }
  }

  async lock(): Promise<void> {
    // Wipe keys from memory
    if (this.fiberKey) {
      this.fiberKey.fill(0);
      this.fiberKey = null;
    }
    if (this.ckbKey) {
      this.ckbKey.fill(0);
      this.ckbKey = null;
    }
  }

  isUnlocked(): boolean {
    return this.fiberKey !== null;
  }

  getIdentifier(): string {
    return this.identifier;
  }
}
