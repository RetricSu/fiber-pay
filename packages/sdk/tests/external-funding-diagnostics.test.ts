import { describe, expect, it, vi } from 'vitest';
import {
	computeSuggestedFundingAmountCkb,
	diagnoseExternalFundingFailure,
	extractRequiredCapacityCkbFromFundingError,
	shouldDiagnoseFundingAbortError,
} from '../src/browser/external-funding-diagnostics.js';

describe('external funding diagnostics', () => {
	it('detects abort-like errors', () => {
		expect(
			shouldDiagnoseFundingAbortError(
				'Channel 0xabc stopped before unsigned external funding tx was returned: AbortFunding',
			),
		).toBe(true);
		expect(shouldDiagnoseFundingAbortError('network timeout')).toBe(false);
	});

	it('extracts required capacity from message', () => {
		expect(
			extractRequiredCapacityCkbFromFundingError('insufficient capacity: value=1001.12345 required'),
		).toBe('1001.12345');
		expect(extractRequiredCapacityCkbFromFundingError('no value info')).toBeNull();
	});

	it('computes suggested amount when capacity is insufficient', () => {
		expect(computeSuggestedFundingAmountCkb('1000', '1001')).toBe('998.999');
	});

	it('builds channel diagnostic summary from listChannels', async () => {
		const listChannels = vi
			.fn()
			.mockResolvedValueOnce({ channels: [] })
			.mockResolvedValueOnce({
				channels: [
					{
						channel_id:
							'0x69cb10774f3ce30c45c9c65df3602ce3df0d4639e81479f52c9acb9d10e0fd49',
						created_at: '0x10',
						failure_detail: 'mocked failure detail',
						state: { state_name: 'NegotiatingFunding', state_flags: [] },
					},
				],
			})
			.mockResolvedValue({ channels: [] });

		const result = await diagnoseExternalFundingFailure({
			node: { listChannels },
			rawError:
				'Channel 0x69cb10774f3ce30c45c9c65df3602ce3df0d4639e81479f52c9acb9d10e0fd49 stopped before unsigned external funding tx was returned: AbortFunding',
			targetPubkey: '0x1234',
		});

		expect(result.channelDiagnostic).toContain('mocked failure detail');
		expect(result.summary).toContain('failure_detail=mocked failure detail');
	});
});
