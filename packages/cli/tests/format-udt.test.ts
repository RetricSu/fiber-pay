import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@fiber-pay/sdk';
import {
  formatChannel,
  getChannelSummary,
  printChannelDetailHuman,
  printChannelListHuman,
} from '../src/lib/format.js';

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    channel_id: '0xchannel1',
    pubkey: '0xpubkey1',
    state: { state_name: 'ChannelReady', state_flags: [] },
    local_balance: '0x5f5e100',
    remote_balance: '0x2faf080',
    funding_udt_type_script: null,
    pending_tlcs: [],
    enabled: true,
    is_public: true,
    created_at: '0x0',
    channel_outpoint: { tx_hash: '0xtx1', index: '0x0' },
    ...overrides,
  } as Channel;
}

function captureLogs(): { output: string[]; restore: () => void } {
  const originalLog = console.log;
  const output: string[] = [];
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(' '));
  };
  return {
    output,
    restore: () => {
      console.log = originalLog;
    },
  };
}

describe('UDT-aware channel formatting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formatChannel labels CKB channels with unit CKB', () => {
    const formatted = formatChannel(makeChannel());
    expect(formatted.unit).toBe('CKB');
    expect(formatted.fundingUdtTypeScript).toBeUndefined();
    expect(formatted.localBalanceCkb).toBe(1);
    expect(formatted.localBalance).toBe(1);
  });

  it('formatChannel labels UDT channels with unit UDT and raw balances', () => {
    const formatted = formatChannel(
      makeChannel({
        local_balance: '0x3e8',
        remote_balance: '0x1f4',
        funding_udt_type_script: {
          code_hash: '0x1234',
          hash_type: 'type',
          args: '0x5678',
        },
      }),
    );

    expect(formatted.unit).toBe('UDT');
    expect(formatted.localBalance).toBe('1000');
    expect(formatted.remoteBalance).toBe('500');
    expect(formatted.capacity).toBe('1500');
    expect(formatted.localBalanceCkb).toBeUndefined();
    expect(formatted.fundingUdtTypeScript).toEqual({
      code_hash: '0x1234',
      hash_type: 'type',
      args: '0x5678',
    });
  });

  it('getChannelSummary aggregates CKB and UDT totals separately', () => {
    const summary = getChannelSummary([
      makeChannel({
        channel_id: '0xckb',
        local_balance: '0x5f5e100',
        remote_balance: '0x2faf080',
      }),
      makeChannel({
        channel_id: '0xudt1',
        local_balance: '0x3e8',
        remote_balance: '0x1f4',
        funding_udt_type_script: {
          code_hash: '0x1234',
          hash_type: 'type',
          args: '0x5678',
        },
      }),
      makeChannel({
        channel_id: '0xudt2',
        local_balance: '0x64',
        remote_balance: '0x32',
        funding_udt_type_script: {
          code_hash: '0x1234',
          hash_type: 'type',
          args: '0x5678',
        },
      }),
    ]);

    expect(summary.totalLocalCkb).toBe(1);
    expect(summary.totalRemoteCkb).toBe(0.5);
    expect(summary.totalCapacityCkb).toBe(1.5);
    expect(summary.udtTotals).toHaveLength(1);
    expect(summary.udtTotals).toEqual([
      expect.objectContaining({
        localBalance: '1100',
        remoteBalance: '550',
        capacity: '1650',
        fundingUdtTypeScript: {
          code_hash: '0x1234',
          hash_type: 'type',
          args: '0x5678',
        },
      }),
    ]);
  });

  it('printChannelDetailHuman labels UDT channel balances as UDT', () => {
    const { output, restore } = captureLogs();
    printChannelDetailHuman(
      makeChannel({
        local_balance: '0x3e8',
        remote_balance: '0x1f4',
        funding_udt_type_script: {
          code_hash: '0x1234',
          hash_type: 'type',
          args: '0x5678',
        },
      }),
    );
    restore();

    const joined = output.join('\n');
    expect(joined).toContain('local 1000 UDT | remote 500 UDT | capacity 1500 UDT');
    expect(joined).toContain('UDT Type Script:');
  });

  it('printChannelListHuman labels UDT rows with UDT unit', () => {
    const { output, restore } = captureLogs();
    printChannelListHuman([
      makeChannel({
        channel_id: '0xckb',
        local_balance: '0x5f5e100',
        remote_balance: '0x2faf080',
      }),
      makeChannel({
        channel_id: '0xudt',
        local_balance: '0x3e8',
        remote_balance: '0x1f4',
        funding_udt_type_script: {
          code_hash: '0x1234',
          hash_type: 'type',
          args: '0x5678',
        },
      }),
    ]);
    restore();

    const joined = output.join('\n');
    expect(joined).toContain('UDT');
    expect(joined).toContain('1000');
    expect(joined).toContain('500');
  });
});
