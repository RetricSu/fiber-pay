import { describe, expect, it, vi } from 'vitest';
import {
	cccScriptToFiberScript,
	createCccExternalFundingResolver,
	createCccSignFundingTx,
	resolveFundingLockCellDepsByKnownScript,
} from '../src/browser/ccc-external-funding.js';

describe('ccc external funding helpers', () => {
	it('converts CCC script shape to Fiber script shape', () => {
		const script = cccScriptToFiberScript({
			codeHash: '0x1234',
			hashType: 'type',
			args: 'abcd',
		});

		expect(script).toEqual({
			code_hash: '0x1234',
			hash_type: 'type',
			args: '0xabcd',
		});
	});

	it('resolves known script deps and maps dep type to Fiber format', async () => {
		const signer = {
			signTransaction: vi.fn(),
			client: {
				getKnownScript: vi.fn().mockImplementation(async (knownScript: string) => {
					if (knownScript !== 'SECP256K1_BLAKE160') {
						throw new Error('not found');
					}

					return {
						codeHash: '0x1234',
						hashType: 'type',
						cellDeps: [
							{
								cellDep: {
									outPoint: {
										txHash: '0xaaaa',
										index: 0n,
									},
									depType: 'depGroup' as const,
								},
							},
						],
					};
				}),
			},
		};

		const result = await resolveFundingLockCellDepsByKnownScript(
			signer,
			{
				code_hash: '0x1234',
				hash_type: 'type',
				args: '0x',
			},
			['ACP', 'SECP256K1_BLAKE160'],
		);

		expect(result?.knownScript).toBe('SECP256K1_BLAKE160');
		expect(result?.cellDeps[0]).toEqual({
			out_point: {
				tx_hash: '0xaaaa',
				index: '0x0',
			},
			dep_type: 'dep_group',
		});
	});

	it('creates signFundingTx callback with default snake_case conversion', async () => {
		const signer = {
			signTransaction: vi.fn().mockResolvedValue({
				cellDeps: [{ depType: 'depGroup', outPoint: { txHash: '0x1', index: '0x0' } }],
				headerDeps: [],
				inputs: [],
				outputs: [],
				outputsData: [],
				witnesses: [],
			}),
			client: {
				getKnownScript: vi.fn(),
			},
		};

		const signFundingTx = createCccSignFundingTx(signer);
		const result = await signFundingTx({ inputs: [] });
		expect(result.cell_deps?.[0]?.dep_type).toBe('dep_group');
	});

	it('creates a CCC external funding resolver for FiberNodeButton-style flows', async () => {
		const onKnownScriptResolved = vi.fn();
		const onAddressResolved = vi.fn();
		const signer = {
			signTransaction: vi.fn(async (tx: unknown) => tx),
			getRecommendedAddressObj: vi.fn(async () => ({
				script: {
					codeHash: '0x1234',
					hashType: 'type' as const,
					args: '0xabcd',
				},
				toString: () => 'ckt1qyqv9...',
			})),
			client: {
				getKnownScript: vi.fn(async () => ({
					codeHash: '0x1234',
					hashType: 'type' as const,
					cellDeps: [
						{
							cellDep: {
								outPoint: {
									txHash: '0xbeef',
									index: 1,
								},
								depType: 'code' as const,
							},
						},
					],
				})),
			},
		};

		const resolve = createCccExternalFundingResolver({
			signer,
			knownScripts: ['SECP256K1_BLAKE160'],
			ckbRpcUrl: 'https://testnet.ckbapp.dev/',
			onKnownScriptResolved,
			onAddressResolved,
		});

		const result = await resolve({});

		expect(result.shutdownScript).toEqual({
			code_hash: '0x1234',
			hash_type: 'type',
			args: '0xabcd',
		});
		expect(result.fundingLockScript).toEqual(result.shutdownScript);
		expect(result.fundingLockScriptCellDeps).toEqual([
			{
				out_point: {
					tx_hash: '0xbeef',
					index: '0x1',
				},
				dep_type: 'code',
			},
		]);
		expect(result.ckbRpcUrl).toBe('https://testnet.ckbapp.dev/');
		expect(typeof result.signFundingTx).toBe('function');
		expect(onKnownScriptResolved).toHaveBeenCalledWith('SECP256K1_BLAKE160');
		expect(onAddressResolved).toHaveBeenCalledTimes(1);
	});

	it('skips known script lookup when no knownScripts are provided', async () => {
		const signer = {
			signTransaction: vi.fn(async (tx: unknown) => tx),
			getRecommendedAddressObj: vi.fn(async () => ({
				script: {
					codeHash: '0x1234',
					hashType: 'type' as const,
					args: '0xabcd',
				},
			})),
			client: {
				getKnownScript: vi.fn(),
			},
		};

		const resolve = createCccExternalFundingResolver({ signer });
		const result = await resolve({});

		expect(result.fundingLockScriptCellDeps).toBeUndefined();
		expect(signer.client.getKnownScript).not.toHaveBeenCalled();
	});
});
