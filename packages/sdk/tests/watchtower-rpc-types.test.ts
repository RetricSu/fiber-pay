import { describe, expect, it } from 'vitest';
import type { CreateWatchChannelParams } from '../src/types/rpc.js';

describe('watchtower RPC wire types', () => {
  it('serializes Channel V2 as channel_features, matching fnn v0.10.1', () => {
    const params = {
      channel_id: '0x01',
      local_settlement_key: '0x02',
      remote_settlement_key: '0x03',
      local_funding_pubkey: '0x04',
      remote_funding_pubkey: '0x05',
      settlement_data: { local_amount: '0x64', remote_amount: '0xc8', tlcs: [] },
      channel_features: '0x1',
    } satisfies CreateWatchChannelParams;

    const wire = JSON.parse(JSON.stringify(params));
    expect(wire).toEqual({
      channel_id: '0x01',
      local_settlement_key: '0x02',
      remote_settlement_key: '0x03',
      local_funding_pubkey: '0x04',
      remote_funding_pubkey: '0x05',
      settlement_data: { local_amount: '0x64', remote_amount: '0xc8', tlcs: [] },
      channel_features: '0x1',
    });
    expect(wire).not.toHaveProperty('commitment_contract_features');
  });
});
