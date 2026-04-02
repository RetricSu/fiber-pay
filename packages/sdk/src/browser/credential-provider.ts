/**
 * CredentialProvider — Decoupled key management interface for Fiber WASM nodes
 *
 * Design principles:
 * 1. Key *acquisition* and *usage* are separated
 * 2. Supports automation — once unlocked, subsequent operations don't require user interaction
 * 3. Extensible for future credential backends (e.g. WebAuthn Passkeys)
 *
 * The Fiber WASM node receives keys once at start() and handles all channel/PTLC signing
 * internally. Users only need to interact during the unlock() phase.
 */

// =============================================================================
// Core Interface
// =============================================================================

/**
 * Abstract credential provider for Fiber WASM node key management.
 *
 * Implementations control how keys are derived, stored, and accessed.
 * The provider must be unlocked before keys can be retrieved.
 */
export interface CredentialProvider {
  /**
   * Get the Fiber node key pair (used for P2P identity).
   * Must be 32 bytes.
   * @throws if provider is not unlocked
   */
  getFiberKeyPair(): Promise<Uint8Array>;

  /**
   * Get the CKB secret key (used for on-chain signing).
   * Must be 32 bytes. Returns undefined if using external funding mode.
   * @throws if provider is not unlocked
   */
  getCkbSecretKey(): Promise<Uint8Array | undefined>;

  /**
   * Unlock the credential provider — this is where user interaction happens.
   *
   * For password-based providers, the password is supplied here.
   * For passkey providers, this would trigger WebAuthn ceremony.
   * After unlock(), all subsequent key retrievals are automatic.
   *
   * @param params - Implementation-specific unlock parameters
   */
  unlock(params?: unknown): Promise<void>;

  /**
   * Lock the credential provider — wipe keys from memory.
   * After lock(), getFiberKeyPair() and getCkbSecretKey() will throw.
   */
  lock(): Promise<void>;

  /**
   * Whether the provider is currently unlocked.
   */
  isUnlocked(): boolean;

  /**
   * Unique identifier for this credential.
   * Used for IndexedDB prefix isolation so multiple identities
   * can coexist in the same browser.
   */
  getIdentifier(): string;
}

// =============================================================================
// Unlock Parameter Types
// =============================================================================

/**
 * Unlock parameters for PasswordCredentialProvider
 */
export interface PasswordUnlockParams {
  /** Password used to derive keys via scrypt */
  password: string;
}

/**
 * Unlock parameters for RawKeyCredentialProvider (no-op, always unlocked)
 */
export type RawKeyUnlockParams = undefined;
