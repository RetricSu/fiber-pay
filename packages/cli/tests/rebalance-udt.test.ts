import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import {
  registerChannelRebalanceCommand,
  registerPaymentRebalanceCommand,
} from '../src/commands/rebalance.js';
import type { CliConfig } from '../src/lib/config.js';

const buildRouter = vi.fn().mockResolvedValue({
  router_hops: [
    {
      target: '0xpeer1',
      channel_outpoint: { tx_hash: '0xtx1', index: '0x0' },
      amount_received: '0x3e8',
      incoming_tlc_expiry: '0x123',
    },
    {
      target: '0xpeer2',
      channel_outpoint: { tx_hash: '0xtx2', index: '0x0' },
      amount_received: '0x3e8',
      incoming_tlc_expiry: '0x123',
    },
  ],
});

const sendPayment = vi.fn().mockResolvedValue({
  payment_hash: '0xdeadbeef',
  status: 'Success',
  fee: '0x0',
  failed_error: undefined,
});

const sendPaymentWithRouter = vi.fn().mockResolvedValue({
  payment_hash: '0xcafebabe',
  status: 'Success',
  fee: '0x0',
  failed_error: undefined,
});

const listChannels = vi.fn().mockResolvedValue({
  channels: [
    {
      channel_id: '0xch1',
      pubkey: '0xpeer1',
      state: { state_name: 'ChannelReady' },
      local_balance: '0x0',
      remote_balance: '0x0',
      pending_tlcs: [],
      enabled: true,
      is_public: true,
      created_at: '0x0',
    },
    {
      channel_id: '0xch2',
      pubkey: '0xpeer2',
      state: { state_name: 'ChannelReady' },
      local_balance: '0x0',
      remote_balance: '0x0',
      pending_tlcs: [],
      enabled: true,
      is_public: true,
      created_at: '0x0',
    },
  ],
});

const nodeInfo = vi.fn().mockResolvedValue({
  pubkey: '0xself',
  udt_cfg_infos: [
    {
      name: 'RUSD',
      script: { code_hash: '0x1234', hash_type: 'type', args: '0x5678' },
      cell_deps: [],
    },
  ],
});

vi.mock('../src/lib/rpc.js', () => ({
  createReadyRpcClient: vi.fn().mockImplementation(() =>
    Promise.resolve({
      nodeInfo,
      buildRouter,
      sendPayment,
      sendPaymentWithRouter,
      listChannels,
    }),
  ),
  resolveRpcEndpoint: vi.fn().mockReturnValue({ target: 'node-rpc', url: 'http://localhost' }),
}));

function makeConfig(): CliConfig {
  return {
    dataDir: '/tmp/fiber-pay-test',
    configPath: '/tmp/fiber-pay-test/config.yml',
    network: 'testnet' as const,
    rpcUrl: 'http://127.0.0.1:8227',
  };
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

describe('payment rebalance UDT', () => {
  beforeEach(() => {
    buildRouter.mockClear();
    sendPayment.mockClear();
    sendPaymentWithRouter.mockClear();
    nodeInfo.mockClear();
  });

  it('auto rebalance forwards udt_type_script to sendPayment', async () => {
    const parent = new Command('payment');
    registerPaymentRebalanceCommand(parent, makeConfig());

    await parent.parseAsync([
      'node',
      'script',
      'rebalance',
      '--amount',
      '1000',
      '--udt-name',
      'RUSD',
      '--json',
    ]);

    expect(sendPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '0x3e8',
        udt_type_script: { code_hash: '0x1234', hash_type: 'type', args: '0x5678' },
      }),
    );
  });

  it('manual rebalance forwards udt_type_script to buildRouter and sendPaymentWithRouter', async () => {
    const parent = new Command('payment');
    registerPaymentRebalanceCommand(parent, makeConfig());

    await parent.parseAsync([
      'node',
      'script',
      'rebalance',
      '--amount',
      '1000',
      '--hops',
      '0xpeer1',
      '--udt-name',
      'RUSD',
      '--json',
    ]);

    expect(buildRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '0x3e8',
        udt_type_script: { code_hash: '0x1234', hash_type: 'type', args: '0x5678' },
      }),
    );
    expect(sendPaymentWithRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        udt_type_script: { code_hash: '0x1234', hash_type: 'type', args: '0x5678' },
      }),
    );
  });

  it('parses UDT amount as a raw integer', async () => {
    const parent = new Command('payment');
    registerPaymentRebalanceCommand(parent, makeConfig());

    await parent.parseAsync([
      'node',
      'script',
      'rebalance',
      '--amount',
      '999',
      '--udt-name',
      'RUSD',
      '--json',
    ]);

    const [params] = sendPayment.mock.calls[0];
    expect(params).toHaveProperty('amount', '0x3e7');
  });

  it('interprets amount as CKB when no UDT option is provided', async () => {
    const parent = new Command('payment');
    registerPaymentRebalanceCommand(parent, makeConfig());

    await parent.parseAsync([
      'node',
      'script',
      'rebalance',
      '--amount',
      '1.5',
      '--json',
    ]);

    const [params] = sendPayment.mock.calls[0];
    expect(params).toHaveProperty('amount', '0x8f0d180');
    expect(params).not.toHaveProperty('udt_type_script');
  });

  it('JSON output includes unit and udtTypeScript', async () => {
    const { output, restore } = captureLogs();
    const parent = new Command('payment');
    registerPaymentRebalanceCommand(parent, makeConfig());

    await parent.parseAsync([
      'node',
      'script',
      'rebalance',
      '--amount',
      '1000',
      '--udt-name',
      'RUSD',
      '--json',
    ]);
    restore();

    const json = JSON.parse(output.join('\n'));
    expect(json.success).toBe(true);
    expect(json.data.unit).toBe('RUSD');
    expect(json.data.amount).toBe('1000');
    expect(json.data.udtTypeScript).toEqual({
      code_hash: '0x1234',
      hash_type: 'type',
      args: '0x5678',
    });
  });
});

describe('channel rebalance UDT', () => {
  beforeEach(() => {
    buildRouter.mockClear();
    sendPayment.mockClear();
    sendPaymentWithRouter.mockClear();
    nodeInfo.mockClear();
    listChannels.mockClear();
  });

  it('guided rebalance forwards udt_type_script through manual hops', async () => {
    const parent = new Command('channel');
    registerChannelRebalanceCommand(parent, makeConfig());

    await parent.parseAsync([
      'node',
      'script',
      'rebalance',
      '--amount',
      '1000',
      '--from-channel',
      '0xch1',
      '--to-channel',
      '0xch2',
      '--udt-name',
      'RUSD',
      '--json',
    ]);

    expect(buildRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '0x3e8',
        udt_type_script: { code_hash: '0x1234', hash_type: 'type', args: '0x5678' },
      }),
    );
    expect(sendPaymentWithRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        udt_type_script: { code_hash: '0x1234', hash_type: 'type', args: '0x5678' },
      }),
    );
  });
});
