/**
 * MacaroonService
 *
 * Handles L402 macaroon minting, verification, and caveat management.
 * Uses the `macaroon` npm package for cryptographic operations and
 * Node.js built-in `crypto` for SHA-256 hashing.
 */

import { createHash } from 'crypto';
import * as macaroon from 'macaroon';

// ─── Types ─────────────────────────────────────────────────

export interface MacaroonCaveat {
  condition: string;
  value: string;
}

export interface MintParams {
  identifier: string;
  paymentHash: string;
  resourceId?: string;
  resourceType?: string;
  expirySeconds?: number;
  location?: string;
}

export interface VerifyResult {
  valid: boolean;
  error?: string;
  caveats?: Record<string, string>;
}

// ─── Service ───────────────────────────────────────────────

export class MacaroonService {
  private rootKey: Buffer;

  constructor(rootKey?: string) {
    const keyHex = rootKey || process.env.L402_ROOT_KEY || this.generateRootKey();
    this.rootKey = Buffer.from(keyHex.replace(/^0x/, ''), 'hex');

    if (this.rootKey.length !== 32) {
      throw new Error('Root key must be 32 bytes (64 hex characters)');
    }
  }

  /**
   * Mint a new macaroon with embedded caveats.
   *
   * The macaroon identifier encodes the payment hash, resource info, and
   * version. First-party caveats are added for payment_hash, expiry, and
   * optionally resource_id / resource_type.
   */
  mint(params: MintParams): { macaroon: string; caveats: MacaroonCaveat[] } {
    const expiryTimestamp = Math.floor(Date.now() / 1000) + (params.expirySeconds || 3600);

    const caveats: MacaroonCaveat[] = [
      { condition: 'payment_hash', value: params.paymentHash },
      { condition: 'expiry', value: expiryTimestamp.toString() },
    ];

    if (params.resourceId) {
      caveats.push({ condition: 'resource_id', value: params.resourceId });
    }
    if (params.resourceType) {
      caveats.push({ condition: 'resource_type', value: params.resourceType });
    }

    const identifier = JSON.stringify({
      v: 0,
      pid: params.paymentHash,
      rid: params.resourceId,
      rtype: params.resourceType,
      loc: params.location || 'fiber-l402',
    });

    const m = macaroon.newMacaroon({
      rootKey: this.rootKey,
      identifier,
      location: params.location || 'fiber-l402',
    });

    for (const caveat of caveats) {
      m.addFirstPartyCaveat(`${caveat.condition}=${caveat.value}`);
    }

    const exported = m.exportJSON();
    const macaroonB64 = Buffer.from(JSON.stringify(exported)).toString('base64');

    return { macaroon: macaroonB64, caveats };
  }

  /**
   * Verify a macaroon with a payment preimage.
   *
   * Validates:
   * 1. SHA-256(preimage) === payment_hash in the macaroon identifier
   * 2. Macaroon signature against root key
   * 3. Expiry caveat is not past
   */
  verify(macaroonB64: string, preimage: string): VerifyResult {
    try {
      const exported = JSON.parse(Buffer.from(macaroonB64, 'base64').toString());
      const m = macaroon.importMacaroon(exported);

      const identifierBytes = m.identifier;
      const identifier = Buffer.from(identifierBytes).toString('utf-8');
      const idData = JSON.parse(identifier);
      const paymentHash = idData.pid;

      const preimageHash = createHash('sha256')
        .update(Buffer.from(preimage.replace(/^0x/, ''), 'hex'))
        .digest('hex');

      if (preimageHash !== paymentHash.replace(/^0x/, '')) {
        return { valid: false, error: 'Invalid preimage: hash mismatch' };
      }

      const caveatCheck = (caveat: string): string | null => {
        if (caveat.startsWith('expiry=')) {
          const expiry = parseInt(caveat.split('=')[1], 10);
          if (expiry < Math.floor(Date.now() / 1000)) {
            return 'Macaroon expired';
          }
        }
        return null;
      };

      m.verify(this.rootKey, caveatCheck, []);

      const caveats: Record<string, string> = {};
      for (const caveat of m.caveats) {
        const caveatStr = Buffer.from(caveat.identifier).toString('utf-8');
        const [key, value] = caveatStr.split('=');
        if (key && value) {
          caveats[key] = value;
        }
      }

      return { valid: true, caveats };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  /**
   * Verify macaroon signature and caveats without requiring a preimage.
   *
   * Used in the "connected-node" flow where the middleware verifies
   * invoice settlement via Fiber RPC instead of requiring the client
   * to provide the preimage directly.
   */
  verifyWithoutPreimage(macaroonB64: string): VerifyResult {
    try {
      const exported = JSON.parse(Buffer.from(macaroonB64, 'base64').toString());
      const m = macaroon.importMacaroon(exported);

      const caveatCheck = (caveat: string): string | null => {
        if (caveat.startsWith('expiry=')) {
          const expiry = parseInt(caveat.split('=')[1], 10);
          if (expiry < Math.floor(Date.now() / 1000)) {
            return 'Macaroon expired';
          }
        }
        return null;
      };

      m.verify(this.rootKey, caveatCheck, []);

      const caveats: Record<string, string> = {};
      for (const caveat of m.caveats) {
        const caveatStr = Buffer.from(caveat.identifier).toString('utf-8');
        const [key, value] = caveatStr.split('=');
        if (key && value) {
          caveats[key] = value;
        }
      }

      return { valid: true, caveats };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  /** Extract caveats from a macaroon without full verification. */
  extractCaveats(macaroonB64: string): Record<string, string> {
    try {
      const exported = JSON.parse(Buffer.from(macaroonB64, 'base64').toString());
      const m = macaroon.importMacaroon(exported);
      const caveats: Record<string, string> = {};

      for (const caveat of m.caveats) {
        const caveatStr = Buffer.from(caveat.identifier).toString('utf-8');
        const parts = caveatStr.split('=');
        if (parts.length === 2) {
          caveats[parts[0]] = parts[1];
        }
      }

      return caveats;
    } catch {
      return {};
    }
  }

  private generateRootKey(): string {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    return Buffer.from(bytes).toString('hex');
  }
}
