import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FiberWasmFactory, FiberWasmInstance } from '../src/browser/wasm-adapter.js';
import { FiberWasmAdapter } from '../src/browser/wasm-adapter.js';

// =============================================================================
// Mock WASM Instance
// =============================================================================

function createMockInstance(): FiberWasmInstance {
	return {
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		invokeCommand: vi.fn().mockImplementation((method: string) => {
			switch (method) {
				case 'node_info':
					return Promise.resolve({
						version: '0.7.1',
						pubkey: '0xabc',
						node_name: 'test-wasm-node',
						addresses: [],
						chain_hash: '0x000',
						features: [],
						commit_hash: 'abc123',
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
					});
				case 'list_peers':
					return Promise.resolve({ peers: [] });
				case 'list_channels':
					return Promise.resolve({ channels: [] });
				default:
					return Promise.resolve(null);
			}
		}),
	};
}

function createMockFactory(instance?: FiberWasmInstance): FiberWasmFactory {
	return () => instance ?? createMockInstance();
}

// =============================================================================
// Tests
// =============================================================================

describe('FiberWasmAdapter', () => {
	let adapter: FiberWasmAdapter;
	let mockInstance: FiberWasmInstance;

	beforeEach(() => {
		mockInstance = createMockInstance();
		adapter = new FiberWasmAdapter({ factory: () => mockInstance });
	});

	describe('lifecycle', () => {
		it('should start in stopped state', () => {
			expect(adapter.state).toBe('stopped');
		});

		it('should transition to running after start', async () => {
			await adapter.start({
				config: 'test-config',
				fiberKeyPair: new Uint8Array(32),
			});

			expect(adapter.state).toBe('running');
			expect(mockInstance.start).toHaveBeenCalledWith(
				'test-config',
				expect.any(Uint8Array),
				undefined,
				undefined,
				'info',
				undefined,
			);
		});

		it('should transition to stopped after stop', async () => {
			await adapter.start({
				config: 'test-config',
				fiberKeyPair: new Uint8Array(32),
			});
			await adapter.stop();

			expect(adapter.state).toBe('stopped');
			expect(mockInstance.stop).toHaveBeenCalled();
		});

		it('should throw when starting an already running node', async () => {
			await adapter.start({
				config: 'test-config',
				fiberKeyPair: new Uint8Array(32),
			});

			await expect(
				adapter.start({
					config: 'test-config',
					fiberKeyPair: new Uint8Array(32),
				}),
			).rejects.toThrow('already running');
		});

		it('should be a no-op to stop a stopped adapter', async () => {
			await adapter.stop(); // Should not throw
			expect(adapter.state).toBe('stopped');
		});

		it('should transition to error state when start fails', async () => {
			const failingInstance = createMockInstance();
			(failingInstance.start as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('WASM init failed'),
			);

			const failAdapter = new FiberWasmAdapter({ factory: () => failingInstance });

			await expect(
				failAdapter.start({
					config: 'bad-config',
					fiberKeyPair: new Uint8Array(32),
				}),
			).rejects.toThrow('WASM init failed');

			expect(failAdapter.state).toBe('error');
		});
	});

	describe('events', () => {
		it('should emit stateChange events', async () => {
			const states: string[] = [];
			adapter.on('stateChange', (s) => states.push(s as string));

			await adapter.start({
				config: 'test-config',
				fiberKeyPair: new Uint8Array(32),
			});
			await adapter.stop();

			expect(states).toEqual(['starting', 'running', 'stopping', 'stopped']);
		});

		it('should emit error events on start failure', async () => {
			const failingInstance = createMockInstance();
			(failingInstance.start as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('boom'),
			);

			const failAdapter = new FiberWasmAdapter({ factory: () => failingInstance });
			const errors: Error[] = [];
			failAdapter.on('error', (e) => errors.push(e as Error));

			await failAdapter
				.start({ config: 'x', fiberKeyPair: new Uint8Array(32) })
				.catch(() => {});

			expect(errors).toHaveLength(1);
			expect(errors[0].message).toBe('boom');
		});

		it('should support removing listeners with off()', async () => {
			const states: string[] = [];
			const listener = (s: unknown) => states.push(s as string);

			adapter.on('stateChange', listener);
			adapter.off('stateChange', listener);

			await adapter.start({
				config: 'test-config',
				fiberKeyPair: new Uint8Array(32),
			});

			expect(states).toHaveLength(0);
		});
	});

	describe('RPC methods', () => {
		beforeEach(async () => {
			await adapter.start({
				config: 'test-config',
				fiberKeyPair: new Uint8Array(32),
			});
		});

		it('should call nodeInfo', async () => {
			const info = await adapter.nodeInfo();
			expect(info.version).toBe('0.7.1');
			expect(info.pubkey).toBe('0xabc');
		});

		it('should call listPeers', async () => {
			const result = await adapter.listPeers();
			expect(result.peers).toEqual([]);
		});

		it('should call listChannels', async () => {
			const result = await adapter.listChannels();
			expect(result.channels).toEqual([]);
		});

		it('should throw when node is not running', async () => {
			await adapter.stop();
			await expect(adapter.nodeInfo()).rejects.toThrow('not running');
		});

		it('should handle WASM errors gracefully', async () => {
			(mockInstance.invokeCommand as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('RPC timeout'),
			);

			await expect(adapter.nodeInfo()).rejects.toThrow('RPC timeout');
		});

		it('should pass params to invokeCommand correctly', async () => {
			const params = { address: '/ip4/1.2.3.4/tcp/8228/p2p/QmTest' };
			await adapter.connectPeer(params);

			expect(mockInstance.invokeCommand).toHaveBeenCalledWith('connect_peer', [params]);
		});
	});

	describe('invoke (raw)', () => {
		it('should allow raw command invocation', async () => {
			await adapter.start({
				config: 'test-config',
				fiberKeyPair: new Uint8Array(32),
			});

			const result = await adapter.invoke('node_info');
			expect(result).toBeDefined();
		});
	});
});
