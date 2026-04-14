import { describe, expect, it } from 'vitest';
import {
  isPasskeyPotentiallySupported,
  toPasskeyUnavailableReason,
} from '../src/use-fiber-node.js';

describe('useFiberNode passkey support helpers', () => {
  it('treats unknown support reason as potentially supported', () => {
    expect(
      isPasskeyPotentiallySupported({
        supported: false,
        reason: 'unknown',
        isSecureContext: true,
        hasPublicKeyCredential: true,
        hasPlatformAuthenticator: null,
        prfCapable: null,
      }),
    ).toBe(true);
  });

  it('maps explicit unsupported reasons to developer-facing text', () => {
    expect(toPasskeyUnavailableReason('insecure-context')).toContain('secure context');
    expect(toPasskeyUnavailableReason('prf-unsupported')).toContain('PRF');
  });

  it('returns null when passkey is supported', () => {
    expect(toPasskeyUnavailableReason('supported')).toBeNull();
  });
});
