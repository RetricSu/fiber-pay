import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FiberBrowserNode } from '../src/browser/fiber-browser-node.js';
import type { CredentialProvider } from '../src/browser/credential-provider.js';
import type { FiberWasmInstance } from '../src/browser/wasm-adapter.js';

// =============================================================================
// Mocks
// =============================================================================

function createMockCredential(opts?: {
	skipCkb?: boolean;
	throwOnUnlock?: boolean;
}): CredentialProvider {
	let unlocked = false;
	const fiberKey = new Uint8Array(32);
	fiberKey.fill(0xaa);
	const ckbKey = opts?.skipCkb ? undefined : (() => {
		const k = new Uint8Array(32);
		k.fill(0xbb);
		return k;
	})();

	return {
		getFiberKeyPair: vi.fn(async () => {
			if (!unlocked) throw new Error('locked');
			return fiberKey;
		}),
		getCkbSecretKey: vi.fn(async () => {
			if (!unlocked) throw new Error('locked');
			return ckbKey;
		}),
		unlock: vi.fn(async () => {
			if (opts?.throwOnUnlock) throw new Error('bad password');
			unlocked = true;
		}),
		lock: vi.fn(async () => {
			unlocked = false;
		}),
		isUnlocked: vi.fn(() => unlocked),
		getIdentifier: vi.fn(() => 'test-identity'),
	};
}

const MOCK_NODE_INFO = {
	version: '0.7.1',
	pubkey: '0xmocknode',
	node_name: 'test-browser-node',
	addresses: [],
	chain_hash: '0x000',
	features: [],
	commit_hash: 'abc',
	open_channel_auto_accept_min_ckb_funding_amount: '0x0',
	auto_accept_channel_ckb_funding_amount: '0x0',
	default_funding_lock_script: { code_hash: '0x0', hash_type: 'type', args: '0x' },
	tlc_expiry_delta: '0x0',
	tlc_min_value: '0x0',
	tlc_fee_proportional_millionths: '0x0',
	channel_count: '0x0',
	pending_channel_count: '0x0',
	peers_count: '0x0',
	udt_cfg_infos: [],
};

function createMockWasmInstance(): FiberWasmInstance {
	return {
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		invokeCommand: vi.fn().mockImplementation((method: string) => {
			switch (method) {
				case 'node_info':
					return Promise.resolve(MOCK_NODE_INFO);
				case 'list_peers':
					return Promise.resolve({ peers: [] });
				case 'list_channels':
					return Promise.resolve({ channels: [] });
				case 'send_payment':
					return Promise.resolve({
						payment_hash: '0x123',
						status: 'Inflight',
						created_at: '0x0',
						last_updated_at: '0x0',
						fee: '0x0',
					});
				default:
					return Promise.resolve(null);
			}
		}),
	};
}

// =============================================================================
// Tests
// =============================================================================

describe('FiberBrowserNode', () => {
	let node: FiberBrowserNode;
	let credential: CredentialProvider;
	let wasmInstance: FiberWasmInstance;

	beforeEach(() => {
		credential = createMockCredential();
		wasmInstance = createMockWasmInstance();

		node = new FiberBrowserNode({
			network: 'testnet',
			credential,
			wasmFactory: () => wasmInstance,
		});
	});

	describe('lifecycle', () => {
		it('should start in idle state', () => {
			expect(node.state).toBe('idle');
			expect(node.isRunning).toBe(false);
		});

		it('should start successfully with password', async () => {
			const info = await node.start({ password: 'test-pass' });

			expect(info.pubkey).toBe('0xmocknode');
			expect(node.state).toBe('running');
			expect(node.isRunning).toBe(true);
			expect(credential.unlock).toHaveBeenCalledWith({ password: 'test-pass' });
		});

		it('should unlock credential then start WASM in sequence', async () => {
			const callOrder: string[] = [];

			// Create a fresh credential with tracking
			let trackUnlocked = false;
			const fk = new Uint8Array(32);
			fk.fill(0xaa);
			const ck = new Uint8Array(32);
			ck.fill(0xbb);

			const trackingCred: CredentialProvider = {
				getFiberKeyPair: vi.fn(async () => {
					if (!trackUnlocked) throw new Error('locked');
					return fk;
				}),
				getCkbSecretKey: vi.fn(async () => {
					if (!trackUnlocked) throw new Error('locked');
					return ck;
				}),
				unlock: vi.fn(async () => {
					callOrder.push('unlock');
					trackUnlocked = true;
				}),
				lock: vi.fn(async () => { trackUnlocked = false; }),
				isUnlocked: vi.fn(() => trackUnlocked),
				getIdentifier: vi.fn(() => 'test-identity'),
			};

			(wasmInstance.start as ReturnType<typeof vi.fn>).mockImplementation(async () => {
				callOrder.push('wasm-start');
			});

			const trackNode = new FiberBrowserNode({
				network: 'testnet',
				credential: trackingCred,
				wasmFactory: () => wasmInstance,
			});

			await trackNode.start({ password: 'p' });

			expect(callOrder).toEqual(['unlock', 'wasm-start']);
		});

		it('should stop and lock credential', async () => {
			await node.start({ password: 'p' });
			await node.stop();

			expect(node.state).toBe('stopped');
			expect(node.isRunning).toBe(false);
			expect(credential.lock).toHaveBeenCalled();
			expect(wasmInstance.stop).toHaveBeenCalled();
		});

		it('should be a no-op to stop an idle node', async () => {
			await node.stop();
			expect(node.state).toBe('idle');
		});

		it('should throw when starting an already running node', async () => {
			await node.start({ password: 'p' });
			await expect(node.start({ password: 'p' })).rejects.toThrow('already running');
		});

		it('should transition to error on unlock failure', async () => {
			const badCred = createMockCredential({ throwOnUnlock: true });
			const failNode = new FiberBrowserNode({
				network: 'testnet',
				credential: badCred,
				wasmFactory: () => wasmInstance,
			});

			await expect(failNode.start({ password: 'wrong' })).rejects.toThrow('bad password');
			expect(failNode.state).toBe('error');
		});

		it('should transition to error on WASM start failure', async () => {
			(wasmInstance.start as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('WASM crashed'),
			);

			await expect(node.start({ password: 'p' })).rejects.toThrow();
			expect(node.state).toBe('error');
		});
	});

	describe('events', () => {
		it('should emit stateChange during start', async () => {
			const states: string[] = [];
			node.on('stateChange', (s) => states.push(s as string));

			await node.start({ password: 'p' });

			expect(states).toContain('unlocking');
			expect(states).toContain('starting');
			expect(states).toContain('running');
		});

		it('should emit stateChange during stop', async () => {
			await node.start({ password: 'p' });

			const states: string[] = [];
			node.on('stateChange', (s) => states.push(s as string));

			await node.stop();

			expect(states).toContain('stopping');
			expect(states).toContain('stopped');
		});
	});

	describe('RPC proxy methods', () => {
		beforeEach(async () => {
			await node.start({ password: 'p' });
		});

		it('should proxy getNodeInfo', async () => {
			const info = await node.getNodeInfo();
			expect(info.pubkey).toBe('0xmocknode');
		});

		it('should proxy listPeers', async () => {
			const result = await node.listPeers();
			expect(result.peers).toEqual([]);
		});

		it('should proxy listChannels', async () => {
			const result = await node.listChannels();
			expect(result.channels).toEqual([]);
		});

		it('should proxy sendPayment', async () => {
			const result = await node.sendPayment({ invoice: 'fibt1test' });
			expect(result.payment_hash).toBe('0x123');
		});

		it('should throw when calling RPC on non-running node', async () => {
			await node.stop();
			await expect(node.getNodeInfo()).rejects.toThrow('not running');
			await expect(node.listPeers()).rejects.toThrow('not running');
		});
	});

	describe('config generation', () => {
		it('should pass database prefix based on credential identifier', async () => {
			await node.start({ password: 'p' });

			expect(wasmInstance.start).toHaveBeenCalledWith(
				expect.stringContaining('testnet'),
				expect.any(Uint8Array),
				expect.any(Uint8Array),
				undefined,
				'info',
				'/wasm-test-identity',
			);
		});

		it('should use custom node config overrides', async () => {
			const customNode = new FiberBrowserNode({
				network: 'testnet',
				credential,
				wasmFactory: () => wasmInstance,
				nodeConfig: {
					logLevel: 'debug',
					databasePrefix: '/custom-prefix',
				},
			});

			await customNode.start({ password: 'p' });

			expect(wasmInstance.start).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Uint8Array),
				expect.any(Uint8Array),
				undefined,
				'debug',
				'/custom-prefix',
			);
		});
	});

	describe('skip unlock when already unlocked', () => {
		it('should not call unlock again if credential is already unlocked', async () => {
			// Pre-unlock the credential
			await credential.unlock({ password: 'pre' });
			(credential.unlock as ReturnType<typeof vi.fn>).mockClear();

			await node.start({ password: 'ignored' });

			expect(credential.unlock).not.toHaveBeenCalled();
		});
	});
});
