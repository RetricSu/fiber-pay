/**
 * Key Manager
 * Handles generation, storage, and encryption of Fiber node keys
 * Keys are isolated from LLM context for security
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { KeyConfig, KeyInfo } from '@fiber-pay/sdk';
import { decryptKey, derivePublicKey, generatePrivateKey, isEncryptedKey } from '@fiber-pay/sdk';

// =============================================================================
// Key Manager
// =============================================================================

export class KeyManager {
  private config: KeyConfig;
  private fiberKeyPath: string;
  private ckbKeyPath: string;

  constructor(config: KeyConfig) {
    this.config = config;
    this.fiberKeyPath = join(config.baseDir, 'fiber', 'sk');
    this.ckbKeyPath = join(config.baseDir, 'ckb', 'key');
  }

  /**
   * Initialize keys - generate if they don't exist and autoGenerate is true
   */
  async initialize(): Promise<{ fiber: KeyInfo; ckb: KeyInfo }> {
    const fiberExists = existsSync(this.fiberKeyPath);
    const ckbExists = existsSync(this.ckbKeyPath);

    if (!fiberExists || !ckbExists) {
      if (!this.config.autoGenerate) {
        throw new Error(
          `Keys not found and autoGenerate is disabled. ` +
            `Missing: ${[!fiberExists && 'fiber', !ckbExists && 'ckb'].filter(Boolean).join(', ')}`,
        );
      }
    }

    // Generate missing keys
    if (!fiberExists) {
      await this.generateKey('fiber');
    }
    if (!ckbExists) {
      await this.generateKey('ckb');
    }

    return {
      fiber: await this.getKeyInfo('fiber'),
      ckb: await this.getKeyInfo('ckb'),
    };
  }

  /**
   * Generate a new key
   */
  async generateKey(type: 'fiber' | 'ckb'): Promise<KeyInfo> {
    const keyPath = type === 'fiber' ? this.fiberKeyPath : this.ckbKeyPath;
    const keyDir = dirname(keyPath);

    // Create directory if it doesn't exist
    if (!existsSync(keyDir)) {
      mkdirSync(keyDir, { recursive: true });
    }

    // Generate 32 random bytes
    const privateKey = generatePrivateKey();

    // The fiber node expects different formats:
    // - fiber/sk: raw 32 bytes
    // - ckb/key: hex string (64 characters)
    let keyData: string | Uint8Array;
    if (type === 'fiber') {
      keyData = privateKey;
    } else {
      keyData = Buffer.from(privateKey).toString('hex');
    }

    // Write key file with restricted permissions
    writeFileSync(keyPath, keyData);
    chmodSync(keyPath, 0o600);

    return this.getKeyInfo(type);
  }

  /**
   * Get information about a key (without exposing the private key)
   */
  async getKeyInfo(type: 'fiber' | 'ckb'): Promise<KeyInfo> {
    const keyPath = type === 'fiber' ? this.fiberKeyPath : this.ckbKeyPath;

    if (!existsSync(keyPath)) {
      throw new Error(`Key not found: ${keyPath}`);
    }

    const keyData = readFileSync(keyPath);
    const encrypted = isEncryptedKey(keyData);

    // Get private key to derive public key
    const privateKey = await this.loadPrivateKey(type);
    const publicKey = await derivePublicKey(privateKey);

    return {
      publicKey,
      encrypted,
      path: keyPath,
      createdAt: Date.now(), // TODO: get actual file creation time
    };
  }

  /**
   * Load and decrypt a private key (for internal use only)
   * This should NEVER be exposed to the LLM context
   */
  private async loadPrivateKey(type: 'fiber' | 'ckb'): Promise<Uint8Array> {
    const keyPath = type === 'fiber' ? this.fiberKeyPath : this.ckbKeyPath;
    const keyData = readFileSync(keyPath);

    if (isEncryptedKey(keyData)) {
      if (!this.config.encryptionPassword) {
        throw new Error('Key is encrypted but no password provided');
      }
      return await decryptKey(keyData, this.config.encryptionPassword);
    }

    // The fiber node stores keys in different formats:
    // - fiber/sk: raw 32 bytes
    // - ckb/key: hex string (64 characters)
    if (type === 'fiber') {
      return new Uint8Array(keyData);
    } else {
      const hexString = keyData.toString('utf-8').trim();
      return new Uint8Array(Buffer.from(hexString, 'hex'));
    }
  }

  /**
   * Export keys for use with the Fiber node process
   * Returns the password to use for FIBER_SECRET_KEY_PASSWORD env var
   */
  getNodeKeyConfig(): { password?: string } {
    return {
      password: this.config.encryptionPassword,
    };
  }
}

/**
 * Create a key manager with environment-based configuration
 */
export function createKeyManager(baseDir: string, options?: Partial<KeyConfig>): KeyManager {
  const password = process.env.FIBER_KEY_PASSWORD || options?.encryptionPassword;

  return new KeyManager({
    baseDir,
    encryptionPassword: password,
    autoGenerate: options?.autoGenerate ?? true,
  });
}
