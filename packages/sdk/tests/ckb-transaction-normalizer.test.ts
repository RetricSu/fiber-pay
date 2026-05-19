import { describe, expect, it } from 'vitest';
import {
	normalizeCkbTransactionForCcc,
	normalizeCkbTransactionForRpc,
} from '../src/browser/ckb-transaction-normalizer.js';

describe('ckb transaction normalizer', () => {
	it('converts rpc snake_case tx to ccc camelCase tx', () => {
		const rpcTx = {
			cell_deps: [
				{
					out_point: { tx_hash: '0xabc', index: '0x0' },
					dep_type: 'dep_group',
				},
			],
			header_deps: [],
			inputs: [
				{
					previous_output: { tx_hash: '0xdef', index: '0x1' },
				},
			],
			outputs_data: ['0x'],
		};

		const normalized = normalizeCkbTransactionForCcc(rpcTx) as {
			cellDeps: Array<{ outPoint: { txHash: string }; depType: string }>;
			inputs: Array<{ previousOutput: { txHash: string } }>;
			outputsData: string[];
		};

		expect(normalized.cellDeps[0].outPoint.txHash).toBe('0xabc');
		expect(normalized.cellDeps[0].depType).toBe('depGroup');
		expect(normalized.inputs[0].previousOutput.txHash).toBe('0xdef');
		expect(normalized.outputsData).toEqual(['0x']);
	});

	it('converts ccc camelCase tx to rpc snake_case tx', () => {
		const cccTx = {
			cellDeps: [
				{
					outPoint: { txHash: '0xabc', index: '0x0' },
					depType: 'depGroup',
				},
			],
			headerDeps: [],
			inputs: [
				{
					previousOutput: { txHash: '0xdef', index: '0x1' },
				},
			],
			outputsData: ['0x'],
		};

		const normalized = normalizeCkbTransactionForRpc(cccTx) as {
			cell_deps: Array<{ out_point: { tx_hash: string }; dep_type: string }>;
			inputs: Array<{ previous_output: { tx_hash: string } }>;
			outputs_data: string[];
		};

		expect(normalized.cell_deps[0].out_point.tx_hash).toBe('0xabc');
		expect(normalized.cell_deps[0].dep_type).toBe('dep_group');
		expect(normalized.inputs[0].previous_output.tx_hash).toBe('0xdef');
		expect(normalized.outputs_data).toEqual(['0x']);
	});
});
