import type { CredentialProvider } from './credential-provider.js';
import { base64urlToBuffer, bufferToBase64url } from './utils/base64url.js';

// WebAuthn PRF Extension Types
interface AuthenticationExtensionsClientInputsWithPRF extends AuthenticationExtensionsClientInputs {
  prf?: {
    eval?: {
      first: ArrayBuffer;
    };
  };
}

interface AuthenticationExtensionsClientOutputsWithPRF
  extends AuthenticationExtensionsClientOutputs {
  prf?: {
    enabled?: boolean;
    results?: {
      first: ArrayBuffer;
    };
  };
}

export type PasskeySupportReason =
  | 'supported'
  | 'window-unavailable'
  | 'insecure-context'
  | 'webauthn-unavailable'
  | 'prf-unsupported'
  | 'unknown';

export interface PasskeySupportStatus {
  supported: boolean;
  reason: PasskeySupportReason;
  isSecureContext: boolean;
  hasPublicKeyCredential: boolean;
  hasPlatformAuthenticator: boolean | null;
  prfCapable: boolean | null;
}

export class PasskeyCredentialProvider implements CredentialProvider {
  private identifier: string;
  private fiberKey: Uint8Array | null = null;
  private ckbKey: Uint8Array | null = null;
  private skipCkbKey: boolean;

  constructor(identifier: string, options?: { skipCkbKey?: boolean }) {
    this.identifier = identifier;
    this.skipCkbKey = options?.skipCkbKey ?? false;
  }

  /**
   * Check if the current browser environment supports Passkeys with the PRF extension.
   */
  static async getSupportStatus(): Promise<PasskeySupportStatus> {
    if (typeof window === 'undefined') {
      return {
        supported: false,
        reason: 'window-unavailable',
        isSecureContext: false,
        hasPublicKeyCredential: false,
        hasPlatformAuthenticator: null,
        prfCapable: null,
      };
    }

    const isSecureContext = window.isSecureContext;
    if (!isSecureContext) {
      return {
        supported: false,
        reason: 'insecure-context',
        isSecureContext,
        hasPublicKeyCredential: typeof PublicKeyCredential !== 'undefined',
        hasPlatformAuthenticator: null,
        prfCapable: null,
      };
    }

    if (typeof PublicKeyCredential === 'undefined') {
      return {
        supported: false,
        reason: 'webauthn-unavailable',
        isSecureContext,
        hasPublicKeyCredential: false,
        hasPlatformAuthenticator: null,
        prfCapable: null,
      };
    }

    let hasPlatformAuthenticator: boolean | null = null;

    // Probe platform authenticator availability for diagnostics only.
    // It is not a hard requirement because some Linux environments use
    // non-platform authenticators with WebAuthn + PRF successfully.
    if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      try {
        hasPlatformAuthenticator =
          await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      } catch {
        hasPlatformAuthenticator = null;
      }
    }

    let prfCapable: boolean | null = null;

    // Check for PRF extension support capability
    if (
      'getClientCapabilities' in PublicKeyCredential &&
      typeof PublicKeyCredential.getClientCapabilities === 'function'
    ) {
      try {
        const capabilitiesResult = (
          PublicKeyCredential.getClientCapabilities as unknown as () => unknown
        )();

        const capabilities = (
          capabilitiesResult instanceof Promise ? await capabilitiesResult : capabilitiesResult
        ) as Record<string, boolean> | undefined;

        if (capabilities && typeof capabilities.prf === 'boolean') {
          prfCapable = capabilities.prf;
        }
        // Note: When capabilities.prf is undefined (e.g., Chrome on Linux),
        // we keep prfCapable as null and let the UI decide whether to allow the user to try.
      } catch {
        // Probe failed; treat as unknown capability below.
      }
    }

    if (prfCapable !== true) {
      return {
        supported: false,
        reason: prfCapable === false ? 'prf-unsupported' : 'unknown',
        isSecureContext,
        hasPublicKeyCredential: true,
        hasPlatformAuthenticator,
        prfCapable,
      };
    }

    return {
      supported: true,
      reason: 'supported',
      isSecureContext,
      hasPublicKeyCredential: true,
      hasPlatformAuthenticator,
      prfCapable,
    };
  }

  /**
   * Check if passkey is supported or potentially supported (unknown capability).
   * Returns true when explicitly supported OR when capability is unknown,
   * allowing users to attempt passkey on platforms with incomplete capability reporting.
   */
  static async isSupported(): Promise<boolean> {
    const status = await PasskeyCredentialProvider.getSupportStatus();
    // Consider both 'supported' and 'unknown' as potentially supported
    // This allows users to try passkey on platforms like Chrome/Linux
    return status.supported || status.reason === 'unknown';
  }

  getIdentifier(): string {
    return this.identifier;
  }

  isUnlocked(): boolean {
    return this.fiberKey !== null;
  }

  async unlock(): Promise<void> {
    if (this.isUnlocked()) return;

    const credIdBase64 = localStorage.getItem(`passkey_id_${this.identifier}`);
    const saltBase64 = localStorage.getItem(`passkey_salt_${this.identifier}`);

    if (!credIdBase64 || !saltBase64) {
      throw new Error(
        `Passkey for identifier '${this.identifier}' not found. You must call register() first.`,
      );
    }

    const credentialId = base64urlToBuffer(credIdBase64);
    const salt = base64urlToBuffer(saltBase64);

    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const getOptions: PublicKeyCredentialRequestOptions & {
      extensions?: AuthenticationExtensionsClientInputsWithPRF;
    } = {
      challenge: challenge.buffer,
      allowCredentials: [
        {
          id: credentialId,
          type: 'public-key',
        },
      ],
      userVerification: 'required',
      extensions: {
        prf: {
          eval: {
            first: salt,
          },
        },
      },
    };

    const assertion = (await navigator.credentials.get({
      publicKey: getOptions,
    })) as PublicKeyCredential;

    if (!assertion) {
      throw new Error('Passkey assertion failed or cancelled');
    }

    const extensions =
      assertion.getClientExtensionResults() as AuthenticationExtensionsClientOutputsWithPRF;
    const prfResults = extensions.prf?.results;

    if (!prfResults || !prfResults.first) {
      throw new Error(
        'Authenticator did not return PRF secret. This browser/device combination might not support WebAuthn PRF extension.',
      );
    }

    await this.deriveKeysFromPrf(prfResults.first);
  }

  async lock(): Promise<void> {
    if (this.fiberKey) {
      this.fiberKey.fill(0);
      this.fiberKey = null;
    }
    if (this.ckbKey) {
      this.ckbKey.fill(0);
      this.ckbKey = null;
    }
  }

  async getFiberKeyPair(): Promise<Uint8Array> {
    if (!this.fiberKey) throw new Error('Credential provider is locked');
    return this.fiberKey;
  }

  async getCkbSecretKey(): Promise<Uint8Array | undefined> {
    if (!this.isUnlocked()) throw new Error('Credential provider is locked');
    return this.ckbKey ?? undefined;
  }

  /**
   * Registers a new Passkey and initializes the PRF extension secret.
   * Derives keys automatically and leaves the provider unlocked.
   */
  async register(username: string = 'User'): Promise<void> {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const salt = crypto.getRandomValues(new Uint8Array(32));

    const createOptions: PublicKeyCredentialCreationOptions & {
      extensions?: AuthenticationExtensionsClientInputsWithPRF;
    } = {
      rp: {
        name: 'Fiber Web Wallet',
        id: window.location.hostname,
      },
      user: {
        id: userId.buffer,
        name: username,
        displayName: username,
      },
      challenge: challenge.buffer,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'required',
      },
      extensions: {
        prf: {
          eval: {
            first: salt.buffer,
          },
        },
      },
    };

    const credential = (await navigator.credentials.create({
      publicKey: createOptions,
    })) as PublicKeyCredential;

    if (!credential) {
      throw new Error('Passkey creation failed or cancelled');
    }

    const extensions =
      credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputsWithPRF;
    let prfOutput: ArrayBuffer | undefined = extensions.prf?.results?.first;

    // Some authenticators do not evaluate PRF on creation, only asserting `enabled: true`.
    // We must immediately perform an assertion to get the secret.
    if (!prfOutput) {
      if (!extensions.prf || !extensions.prf.enabled) {
        throw new Error('WebAuthn PRF extension is not supported by this authenticator/device.');
      }

      const assertOptions: PublicKeyCredentialRequestOptions & {
        extensions?: AuthenticationExtensionsClientInputsWithPRF;
      } = {
        challenge: crypto.getRandomValues(new Uint8Array(32)).buffer,
        allowCredentials: [
          {
            id: credential.rawId,
            type: 'public-key',
          },
        ],
        userVerification: 'required',
        extensions: {
          prf: {
            eval: { first: salt.buffer },
          },
        },
      };

      const assertion = (await navigator.credentials.get({
        publicKey: assertOptions,
      })) as PublicKeyCredential;
      const assertExts =
        assertion.getClientExtensionResults() as AuthenticationExtensionsClientOutputsWithPRF;

      prfOutput = assertExts.prf?.results?.first;
      if (!prfOutput) {
        throw new Error('Failed to extract PRF secret after fallback assertion.');
      }
    }

    // Save salt and credential ID to storage for future unlocks
    localStorage.setItem(`passkey_id_${this.identifier}`, bufferToBase64url(credential.rawId));
    localStorage.setItem(`passkey_salt_${this.identifier}`, bufferToBase64url(salt.buffer));

    await this.deriveKeysFromPrf(prfOutput);
  }

  /**
   * Clears the passkey connection info for this identifier.
   */
  async discard(): Promise<void> {
    await this.lock();
    localStorage.removeItem(`passkey_id_${this.identifier}`);
    localStorage.removeItem(`passkey_salt_${this.identifier}`);
  }

  /**
   * Has a passkey been registered for this identifier to attempt unlocking?
   */
  isConfigured(): boolean {
    return !!localStorage.getItem(`passkey_id_${this.identifier}`);
  }

  /**
   * Use HKDF to expand the 32-byte PRF secret into 64 bytes (32 for Fiber, 32 for CKB).
   */
  private async deriveKeysFromPrf(prfSecret: ArrayBuffer) {
    const encoder = new TextEncoder();
    const info = encoder.encode('fiber-pay-passkey-derivation-v1');
    const hkdfSalt = encoder.encode('ckb-fiber-salt');

    const keyMaterial = await crypto.subtle.importKey('raw', prfSecret, { name: 'HKDF' }, false, [
      'deriveBits',
    ]);

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: hkdfSalt,
        info,
      },
      keyMaterial,
      512, // 64 bytes total
    );

    const derivedBytes = new Uint8Array(derivedBits);

    this.fiberKey = new Uint8Array(derivedBytes.slice(0, 32));

    if (!this.skipCkbKey) {
      this.ckbKey = new Uint8Array(derivedBytes.slice(32, 64));
    }

    // Wipe the original derived payload from memory immediately
    derivedBytes.fill(0);
  }
}
