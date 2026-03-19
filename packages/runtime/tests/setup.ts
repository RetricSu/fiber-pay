// tests/setup.ts - Setup file for vitest
import { vi } from 'vitest';

// Mock @biscuit-auth/biscuit-wasm before any tests run
vi.mock('@biscuit-auth/biscuit-wasm', () => ({
  Biscuit: {
    fromBase64: vi.fn(),
    builder: vi.fn(() => ({
      addCode: vi.fn(),
      build: vi.fn(() => ({
        toBase64: vi.fn(() => 'mock-biscuit-token'),
      })),
    })),
  },
  PublicKey: {
    fromBytes: vi.fn(),
  },
  PrivateKey: {
    fromBytes: vi.fn(),
  },
  KeyPair: {
    fromPrivateKey: vi.fn(),
  },
  SignatureAlgorithm: {
    Ed25519: 'Ed25519',
  },
}));
