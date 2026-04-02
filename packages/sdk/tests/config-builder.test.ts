import { describe, expect, it } from 'vitest';
import { ConfigBuilder } from '../src/browser/config-builder.js';

describe('ConfigBuilder', () => {
	describe('build', () => {
		it('should generate valid YAML config for testnet', () => {
			const yaml = ConfigBuilder.build({ network: 'testnet' });

			expect(yaml).toContain('chain: testnet');
			expect(yaml).toContain('bootnode_addrs:');
			expect(yaml).toContain('thrall.fiber.channel');
			expect(yaml).toContain('onyxia.fiber.channel');
			expect(yaml).toContain('testnet.ckbapp.dev');
			expect(yaml).toContain('FundingLock');
			expect(yaml).toContain('CommitmentLock');
			expect(yaml).toContain('announce_listening_addr: false');
			// Testnet includes RUSD UDT by default
			expect(yaml).toContain('RUSD');
		});

		it('should generate valid YAML config for mainnet', () => {
			const yaml = ConfigBuilder.build({ network: 'mainnet' });

			expect(yaml).toContain('garrosh.fiber.channel');
			expect(yaml).toContain('sylvanas.fiber.channel');
			expect(yaml).toContain('mainnet.ckbapp.dev');
			expect(yaml).toContain('FundingLock');
			expect(yaml).toContain('CommitmentLock');
		});

		it('should use custom bootnodes when provided', () => {
			const yaml = ConfigBuilder.build({
				network: 'testnet',
				bootnodes: ['/ip4/1.2.3.4/tcp/8228/p2p/QmCustomNode'],
			});

			expect(yaml).toContain('QmCustomNode');
			expect(yaml).not.toContain('thrall.fiber.channel');
		});

		it('should use custom CKB RPC URL when provided', () => {
			const yaml = ConfigBuilder.build({
				network: 'testnet',
				ckbRpcUrl: 'https://my-custom-rpc.example.com/',
			});

			expect(yaml).toContain('my-custom-rpc.example.com');
			expect(yaml).not.toContain('testnet.ckbapp.dev');
		});

		it('should include required services', () => {
			const yaml = ConfigBuilder.build({ network: 'testnet' });

			expect(yaml).toContain('services:');
			expect(yaml).toContain('fiber');
			expect(yaml).toContain('rpc');
			expect(yaml).toContain('ckb');
		});

		it('should set announce_listening_addr to false by default for browser', () => {
			const yaml = ConfigBuilder.build({ network: 'testnet' });
			expect(yaml).toContain('announce_listening_addr: false');
		});

		it('should allow overriding announce_listening_addr', () => {
			const yaml = ConfigBuilder.build({
				network: 'testnet',
				announceListeningAddr: true,
			});
			expect(yaml).toContain('announce_listening_addr: true');
		});

		it('should include Fiber scripts (FundingLock + CommitmentLock)', () => {
			const yaml = ConfigBuilder.build({ network: 'testnet' });

			// FundingLock code_hash
			expect(yaml).toContain(
				'0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c',
			);
			// CommitmentLock code_hash
			expect(yaml).toContain(
				'0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8',
			);
		});

		it('should support custom UDT whitelist', () => {
			const yaml = ConfigBuilder.build({
				network: 'testnet',
				udtWhitelist: [
					{
						name: 'MyToken',
						script: {
							code_hash: '0xabcdef',
							hash_type: 'type',
							args: '0x1234',
						},
						cellDeps: [
							{
								typeId: {
									code_hash: '0x00',
									hash_type: 'type',
									args: '0x99',
								},
							},
						],
						autoAcceptAmount: '500000000',
					},
				],
			});

			expect(yaml).toContain('MyToken');
			expect(yaml).toContain('0xabcdef');
			// Should use custom list, not default RUSD
			expect(yaml).not.toContain('RUSD');
		});
	});

	describe('getDefaults', () => {
		it('should return testnet defaults', () => {
			const defaults = ConfigBuilder.getDefaults('testnet');

			expect(defaults.bootnodes).toHaveLength(2);
			expect(defaults.bootnodes[0]).toContain('thrall.fiber.channel');
			expect(defaults.ckbRpcUrl).toContain('testnet');
			expect(defaults.scripts).toHaveLength(2);
		});

		it('should return mainnet defaults', () => {
			const defaults = ConfigBuilder.getDefaults('mainnet');

			expect(defaults.bootnodes).toHaveLength(2);
			expect(defaults.bootnodes[0]).toContain('garrosh.fiber.channel');
			expect(defaults.ckbRpcUrl).toContain('mainnet');
		});
	});
});
