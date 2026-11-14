import { describe, expect, it } from 'vitest';
import { ConfigBuilder } from '../src/browser/config-builder.js';

const TYPE_ID_CODE_HASH =
	'0x00000000000000000000000000000000000000000000000000545950455f4944';

const EXPECTED_SCRIPTS = {
	testnet: [
		{
			name: 'FundingLock',
			codeHash: '0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c',
			typeIdArgs: '0x3cb7c0304fe53f75bb5727e2484d0beae4bd99d979813c6fc97c3cca569f10f6',
			ckbAuthTxHash: '0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7',
		},
		{
			name: 'CommitmentLock',
			codeHash: '0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8',
			typeIdArgs: '0xf7e458887495cf70dd30d1543cad47dc1dfe9d874177bf19291e4db478d5751b',
			ckbAuthTxHash: '0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7',
		},
	],
	mainnet: [
		{
			name: 'FundingLock',
			codeHash: '0xe45b1f8f21bff23137035a3ab751d75b36a981deec3e7820194b9c042967f4f1',
			typeIdArgs: '0x64818d82a372312fb007c480391e1b9759d21b2c7f7959b9c177d72cdc243394',
			ckbAuthTxHash: '0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6',
		},
		{
			name: 'CommitmentLock',
			codeHash: '0x2d45c4d3ed3e942f1945386ee82a5d1b7e4bb16d7fe1ab015421174ab747406c',
			typeIdArgs: '0xdb16e6dcb17f670e5fb7c556d81e522ec5edb069ad2fa3e898e7ccea6c26a39f',
			ckbAuthTxHash: '0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6',
		},
	],
} as const;

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

		it('should support v0.10.0 additional listening addresses', () => {
			const yaml = ConfigBuilder.build({
				network: 'testnet',
				p2pListeningAddrs: ['/ip6/::/tcp/8228'],
			});

			expect(yaml).toContain('listening_addrs:');
			expect(yaml).toContain('/ip6/::/tcp/8228');
		});

		it.each(['testnet', 'mainnet'] as const)(
			'should use the exact fnn v0.10.0 contracts for %s',
			(network) => {
				const scripts = ConfigBuilder.getDefaults(network).scripts;
				const yaml = ConfigBuilder.build({ network });
				expect(scripts).toHaveLength(2);

				for (const [index, expected] of EXPECTED_SCRIPTS[network].entries()) {
					const script = scripts[index];
					expect(script.name).toBe(expected.name);
					expect(script.script).toEqual({
						code_hash: expected.codeHash,
						hash_type: 'type',
						args: '0x',
					});
					expect(script.cell_deps).toEqual([
						{
							type_id: {
								code_hash: TYPE_ID_CODE_HASH,
								hash_type: 'type',
								args: expected.typeIdArgs,
							},
						},
						{
							cell_dep: {
								out_point: { tx_hash: expected.ckbAuthTxHash, index: '0x0' },
								dep_type: 'code',
							},
						},
					]);
					expect(yaml).toContain(expected.codeHash);
					expect(yaml).toContain(expected.typeIdArgs);
					expect(yaml).toContain(expected.ckbAuthTxHash);
				}
			},
		);

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
