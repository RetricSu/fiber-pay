/**
 * RawKeyCredentialProvider
 *
 * Directly holds raw 32-byte keys. Always "unlocked" after construction.
 * Primarily for development, testing, and advanced use cases where keys
 * are managed externally.
 */

import type { CredentialProvider } from './credential-provider.js';

// =============================================================================
// Implementation
// =============================================================================

export class RawKeyCredentialProvider implements CredentialProvider {
  private fiberKey: Uint8Array | null;
  private ckbKey: Uint8Array | null;
  private identifier: string;
  private locked = false;

  /**
   * @param fiberKeyPair - 32-byte Fiber P2P identity key
   * @param ckbSecretKey - 32-byte CKB secret key (optional for external funding)
   * @param identifier - Unique identity string for IndexedDB prefix isolation
   */
  constructor(fiberKeyPair: Uint8Array, ckbSecretKey?: Uint8Array, identifier = 'raw-key') {
    if (fiberKeyPair.length !== 32) {
      throw new Error('fiberKeyPair must be exactly 32 bytes');
    }
    if (ckbSecretKey && ckbSecretKey.length !== 32) {
      throw new Error('ckbSecretKey must be exactly 32 bytes');
    }

    // Copy keys to avoid external mutation
    this.fiberKey = new Uint8Array(fiberKeyPair);
    this.ckbKey = ckbSecretKey ? new Uint8Array(ckbSecretKey) : null;
    this.identifier = identifier;
  }

  async getFiberKeyPair(): Promise<Uint8Array> {
    if (this.locked || !this.fiberKey) {
      throw new Error('CredentialProvider is locked.');
    }
    return this.fiberKey;
  }

  async getCkbSecretKey(): Promise<Uint8Array | undefined> {
    if (this.locked) {
      throw new Error('CredentialProvider is locked.');
    }
    return this.ckbKey ?? undefined;
  }

  async unlock(): Promise<void> {
    // RawKeyCredentialProvider is always unlocked if keys are present
    if (!this.fiberKey) {
      throw new Error('Keys have been wiped. Create a new provider instance.');
    }
    this.locked = false;
  }

  async lock(): Promise<void> {
    this.locked = true;
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
    return !this.locked && this.fiberKey !== null;
  }

  getIdentifier(): string {
    return this.identifier;
  }
}
