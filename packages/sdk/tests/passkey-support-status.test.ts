import { afterEach, describe, expect, it } from 'vitest';
import { PasskeyCredentialProvider } from '../src/browser/passkey-credential-provider.js';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalPublicKeyCredentialDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'PublicKeyCredential',
);

function restoreGlobal(name: 'window' | 'PublicKeyCredential', descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, name);
}

function setWindowSecureContext(isSecureContext: boolean) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { isSecureContext },
  });
}

function setPublicKeyCredential(value: unknown) {
  Object.defineProperty(globalThis, 'PublicKeyCredential', {
    configurable: true,
    writable: true,
    value,
  });
}

afterEach(() => {
  restoreGlobal('window', originalWindowDescriptor);
  restoreGlobal('PublicKeyCredential', originalPublicKeyCredentialDescriptor);
});

describe('PasskeyCredentialProvider.getSupportStatus', () => {
  it('returns window-unavailable when window is missing', async () => {
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'PublicKeyCredential');

    const status = await PasskeyCredentialProvider.getSupportStatus();

    expect(status.supported).toBe(false);
    expect(status.reason).toBe('window-unavailable');
    expect(status.hasPublicKeyCredential).toBe(false);
  });

  it('returns insecure-context when not in secure context', async () => {
    setWindowSecureContext(false);
    setPublicKeyCredential({});

    const status = await PasskeyCredentialProvider.getSupportStatus();

    expect(status.supported).toBe(false);
    expect(status.reason).toBe('insecure-context');
    expect(status.hasPublicKeyCredential).toBe(true);
  });

  it('returns webauthn-unavailable when PublicKeyCredential is missing', async () => {
    setWindowSecureContext(true);
    Reflect.deleteProperty(globalThis, 'PublicKeyCredential');

    const status = await PasskeyCredentialProvider.getSupportStatus();

    expect(status.supported).toBe(false);
    expect(status.reason).toBe('webauthn-unavailable');
  });

  it('returns prf-unsupported when PRF capability is explicitly false', async () => {
    setWindowSecureContext(true);
    setPublicKeyCredential({
      getClientCapabilities: () => ({ prf: false }),
      isUserVerifyingPlatformAuthenticatorAvailable: async () => false,
    });

    const status = await PasskeyCredentialProvider.getSupportStatus();

    expect(status.supported).toBe(false);
    expect(status.reason).toBe('prf-unsupported');
    expect(status.prfCapable).toBe(false);
    expect(status.hasPlatformAuthenticator).toBe(false);
  });

  it('returns unknown when PRF capability API is missing', async () => {
    setWindowSecureContext(true);
    setPublicKeyCredential({
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    });

    const status = await PasskeyCredentialProvider.getSupportStatus();

    expect(status.supported).toBe(false);
    expect(status.reason).toBe('unknown');
    expect(status.prfCapable).toBeNull();
  });

  it('returns unknown when capability probing throws', async () => {
    setWindowSecureContext(true);
    setPublicKeyCredential({
      getClientCapabilities: () => {
        throw new Error('probe failed');
      },
    });

    const status = await PasskeyCredentialProvider.getSupportStatus();

    expect(status.supported).toBe(false);
    expect(status.reason).toBe('unknown');
    expect(status.prfCapable).toBeNull();
  });

  it('returns supported when PRF capability is explicitly true', async () => {
    setWindowSecureContext(true);
    setPublicKeyCredential({
      getClientCapabilities: () => ({ prf: true }),
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    });

    const status = await PasskeyCredentialProvider.getSupportStatus();

    expect(status.supported).toBe(true);
    expect(status.reason).toBe('supported');
    expect(status.prfCapable).toBe(true);
    expect(status.hasPlatformAuthenticator).toBe(true);
  });
});
