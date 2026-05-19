import { describe, expect, it, vi } from 'vitest';
import { openChannelWithExternalFundingFlow } from '../src/browser/external-funding-flow.js';

describe('openChannelWithExternalFundingFlow', () => {
	it('runs open -> sign -> submit with tx normalization', async () => {
		const openChannelWithExternalFunding = vi.fn().mockResolvedValue({
			channel_id: '0xfeed',
			unsigned_funding_tx: {
				cell_deps: [
					{
						out_point: { tx_hash: '0xabc', index: '0x0' },
						dep_type: 'dep_group',
					},
				],
				inputs: [],
				outputs: [],
				outputs_data: [],
				header_deps: [],
				witnesses: [],
			},
		});

		const submitSignedFundingTx = vi.fn().mockResolvedValue({
			channel_id: '0xfeed',
			funding_tx_hash: '0xdeadbeef',
		});

		const signFundingTx = vi.fn().mockImplementation(async (txForSigner: any) => {
			expect(txForSigner.cellDeps[0].depType).toBe('depGroup');
			return {
				...txForSigner,
				witnesses: ['0xsigned'],
			};
		});

		const result = await openChannelWithExternalFundingFlow({
			node: {
				openChannelWithExternalFunding,
				submitSignedFundingTx,
			},
			params: {
				pubkey: '0x1234',
				funding_amount: '0x174876e800',
				shutdown_script: {
					code_hash: '0x1',
					hash_type: 'type',
					args: '0x',
				},
				funding_lock_script: {
					code_hash: '0x1',
					hash_type: 'type',
					args: '0x',
				},
			},
			signFundingTx,
		});

		expect(openChannelWithExternalFunding).toHaveBeenCalledTimes(1);
		expect(signFundingTx).toHaveBeenCalledTimes(1);
		expect(submitSignedFundingTx).toHaveBeenCalledTimes(1);
		expect(submitSignedFundingTx.mock.calls[0]?.[0]?.signed_funding_tx?.cell_deps?.[0]?.dep_type).toBe(
			'dep_group',
		);
		expect(result.channelId).toBe('0xfeed');
		expect(result.fundingTxHash).toBe('0xdeadbeef');
	});
});
