import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaymentCommand } from '../src/commands/payment.js';
import type { CliConfig } from '../src/lib/config.js';

const buildRouter = vi.fn().mockResolvedValue({
  router_hops: [
    {
      target: '0xaaa',
      channel_outpoint: { tx_hash: '0xtx1', index: '0x0' },
      amount_received: '0x3e8',
      incoming_tlc_expiry: '0x123',
    },
  ],
});

const sendPaymentWithRouter = vi.fn().mockResolvedValue({
  payment_hash: '0xdeadbeef',
  status: 'Success',
  fee: '0x0',
  failed_error: undefined,
});

const nodeInfo = vi.fn().mockResolvedValue({
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
      sendPaymentWithRouter,
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

describe('payment route UDT', () => {
  beforeEach(() => {
    buildRouter.mockClear();
    sendPaymentWithRouter.mockClear();
    nodeInfo.mockClear();
  });

  it('resolves a UDT by name and forwards udt_type_script to buildRouter', async () => {
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'route',
      '--hops',
      '0xaaa',
      '--amount',
      '1000',
      '--udt-name',
      'RUSD',
      '--json',
    ]);

    expect(nodeInfo).toHaveBeenCalledTimes(1);
    expect(buildRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        hops_info: [{ pubkey: '0xaaa' }],
        amount: '0x3e8',
        udt_type_script: { code_hash: '0x1234', hash_type: 'type', args: '0x5678' },
      }),
    );
  });

  it('accepts a raw udt-type-script and forwards it to buildRouter', async () => {
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'route',
      '--hops',
      '0xaaa',
      '--amount',
      '500',
      '--udt-type-script',
      '{"code_hash":"0xabcd","hash_type":"data","args":"0x"}',
      '--json',
    ]);

    expect(nodeInfo).not.toHaveBeenCalled();
    expect(buildRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        udt_type_script: { code_hash: '0xabcd', hash_type: 'data', args: '0x' },
      }),
    );
  });

  it('parses UDT amount as a raw integer', async () => {
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'route',
      '--hops',
      '0xaaa',
      '--amount',
      '999',
      '--udt-name',
      'RUSD',
      '--json',
    ]);

    const [params] = buildRouter.mock.calls[0];
    expect(params).toHaveProperty('amount', '0x3e7');
  });

  it('interprets amount as CKB when no UDT option is provided', async () => {
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'route',
      '--hops',
      '0xaaa',
      '--amount',
      '1.5',
      '--json',
    ]);

    expect(nodeInfo).not.toHaveBeenCalled();
    const [params] = buildRouter.mock.calls[0];
    expect(params).toHaveProperty('amount', '0x8f0d180');
    expect(params).not.toHaveProperty('udt_type_script');
  });

  it('JSON output includes unit UDT and resolved udtTypeScript', async () => {
    const { output, restore } = captureLogs();
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'route',
      '--hops',
      '0xaaa',
      '--amount',
      '1000',
      '--udt-name',
      'RUSD',
      '--json',
    ]);
    restore();

    const json = JSON.parse(output.join('\n'));
    expect(json.success).toBe(true);
    expect(json.data.unit).toBe('UDT');
    expect(json.data.udtTypeScript).toEqual({
      code_hash: '0x1234',
      hash_type: 'type',
      args: '0x5678',
    });
    expect(json.data.routerHops).toHaveLength(1);
  });

  it('human output labels hop amounts with UDT', async () => {
    const { output, restore } = captureLogs();
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'route',
      '--hops',
      '0xaaa',
      '--amount',
      '1000',
      '--udt-name',
      'RUSD',
    ]);
    restore();

    const joined = output.join('\n');
    expect(joined).toContain('Amount:     1000 UDT');
  });

  it('send-route resolves a UDT by name and forwards udt_type_script', async () => {
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'send-route',
      '--router',
      JSON.stringify([
        {
          target: '0xaaa',
          channel_outpoint: { tx_hash: '0xtx1', index: '0x0' },
          amount_received: '0x3e8',
          incoming_tlc_expiry: '0x123',
        },
      ]),
      '--udt-name',
      'RUSD',
      '--json',
    ]);

    expect(nodeInfo).toHaveBeenCalledTimes(1);
    expect(sendPaymentWithRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        udt_type_script: { code_hash: '0x1234', hash_type: 'type', args: '0x5678' },
      }),
    );
  });

  it('send-route accepts a raw udt-type-script', async () => {
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'send-route',
      '--router',
      JSON.stringify([{ target: '0xaaa', channel_outpoint: { tx_hash: '0xtx1', index: '0x0' } }]),
      '--udt-type-script',
      '{"code_hash":"0xabcd","hash_type":"data","args":"0x"}',
      '--json',
    ]);

    expect(nodeInfo).not.toHaveBeenCalled();
    expect(sendPaymentWithRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        udt_type_script: { code_hash: '0xabcd', hash_type: 'data', args: '0x' },
      }),
    );
  });

  it('send-route JSON output includes unit and udtTypeScript', async () => {
    const { output, restore } = captureLogs();
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'send-route',
      '--router',
      JSON.stringify([{ target: '0xaaa', channel_outpoint: { tx_hash: '0xtx1', index: '0x0' } }]),
      '--udt-name',
      'RUSD',
      '--json',
    ]);
    restore();

    const json = JSON.parse(output.join('\n'));
    expect(json.success).toBe(true);
    expect(json.data.unit).toBe('UDT');
    expect(json.data.udtTypeScript).toEqual({
      code_hash: '0x1234',
      hash_type: 'type',
      args: '0x5678',
    });
  });

  it('send-route omits udt_type_script when no UDT option is provided', async () => {
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'send-route',
      '--router',
      JSON.stringify([{ target: '0xaaa', channel_outpoint: { tx_hash: '0xtx1', index: '0x0' } }]),
      '--json',
    ]);

    expect(nodeInfo).not.toHaveBeenCalled();
    const [params] = sendPaymentWithRouter.mock.calls[0];
    expect(params).not.toHaveProperty('udt_type_script');
  });
});
