import { describe, expect, it } from 'vitest';
import { RawKeyCredentialProvider } from '../src/browser/raw-key-credential-provider.js';

function makeKey(fill = 0xaa): Uint8Array {
	const key = new Uint8Array(32);
	key.fill(fill);
	return key;
}

describe('RawKeyCredentialProvider', () => {
	describe('constructor', () => {
		it('should accept valid 32-byte fiber key', () => {
			expect(() => new RawKeyCredentialProvider(makeKey())).not.toThrow();
		});

		it('should reject non-32-byte fiber key', () => {
			expect(() => new RawKeyCredentialProvider(new Uint8Array(16))).toThrow(
				'fiberKeyPair must be exactly 32 bytes',
			);
		});

		it('should reject non-32-byte ckb key', () => {
			expect(
				() => new RawKeyCredentialProvider(makeKey(), new Uint8Array(10)),
			).toThrow('ckbSecretKey must be exactly 32 bytes');
		});

		it('should accept undefined ckb key (external funding mode)', () => {
			const provider = new RawKeyCredentialProvider(makeKey());
			expect(provider.isUnlocked()).toBe(true);
		});

		it('should copy keys to avoid external mutation', () => {
			const original = makeKey(0xbb);
			const provider = new RawKeyCredentialProvider(original);
			original.fill(0); // mutate original

			return provider.getFiberKeyPair().then((key) => {
				// Should still have 0xbb, not 0x00
				expect(key[0]).toBe(0xbb);
			});
		});
	});

	describe('isUnlocked', () => {
		it('should be unlocked immediately after construction', () => {
			const provider = new RawKeyCredentialProvider(makeKey());
			expect(provider.isUnlocked()).toBe(true);
		});

		it('should be locked after lock()', async () => {
			const provider = new RawKeyCredentialProvider(makeKey());
			await provider.lock();
			expect(provider.isUnlocked()).toBe(false);
		});
	});

	describe('getFiberKeyPair', () => {
		it('should return the fiber key when unlocked', async () => {
			const key = makeKey(0xcc);
			const provider = new RawKeyCredentialProvider(key);

			const result = await provider.getFiberKeyPair();
			expect(result[0]).toBe(0xcc);
			expect(result.length).toBe(32);
		});

		it('should throw when locked', async () => {
			const provider = new RawKeyCredentialProvider(makeKey());
			await provider.lock();

			await expect(provider.getFiberKeyPair()).rejects.toThrow('locked');
		});
	});

	describe('getCkbSecretKey', () => {
		it('should return the ckb key when provided', async () => {
			const ckb = makeKey(0xdd);
			const provider = new RawKeyCredentialProvider(makeKey(), ckb);

			const result = await provider.getCkbSecretKey();
			expect(result).toBeDefined();
			expect(result![0]).toBe(0xdd);
		});

		it('should return undefined when ckb key not provided', async () => {
			const provider = new RawKeyCredentialProvider(makeKey());

			const result = await provider.getCkbSecretKey();
			expect(result).toBeUndefined();
		});

		it('should throw when locked', async () => {
			const provider = new RawKeyCredentialProvider(makeKey(), makeKey());
			await provider.lock();

			await expect(provider.getCkbSecretKey()).rejects.toThrow('locked');
		});
	});

	describe('lock', () => {
		it('should wipe keys from memory', async () => {
			const provider = new RawKeyCredentialProvider(makeKey(0xee), makeKey(0xff));

			// Get references before locking
			const fiberKey = await provider.getFiberKeyPair();
			const ckbKey = await provider.getCkbSecretKey();

			await provider.lock();

			// Keys should be zeroed
			expect(fiberKey[0]).toBe(0);
			expect(ckbKey![0]).toBe(0);
		});
	});

	describe('unlock', () => {
		it('should throw after lock() since keys are wiped', async () => {
			const provider = new RawKeyCredentialProvider(makeKey());
			await provider.lock();

			await expect(provider.unlock()).rejects.toThrow('wiped');
		});
	});

	describe('getIdentifier', () => {
		it('should return default identifier', () => {
			const provider = new RawKeyCredentialProvider(makeKey());
			expect(provider.getIdentifier()).toBe('raw-key');
		});

		it('should return custom identifier', () => {
			const provider = new RawKeyCredentialProvider(makeKey(), undefined, 'my-wallet');
			expect(provider.getIdentifier()).toBe('my-wallet');
		});
	});
});
