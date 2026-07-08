import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaymentCommand } from '../src/commands/payment.js';

const sendPayment = vi.fn().mockResolvedValue({
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
      sendPayment,
    }),
  ),
  resolveRpcEndpoint: vi.fn().mockReturnValue({ target: 'node-rpc', url: 'http://localhost' }),
}));

function makeConfig() {
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

describe('payment send UDT resolution', () => {
  beforeEach(() => {
    sendPayment.mockClear();
    nodeInfo.mockClear();
  });

  it('resolves a UDT by name and includes udt_type_script in sendPayment params', async () => {
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'send',
      '--to',
      '0xabcd',
      '--amount',
      '1000',
      '--udt-name',
      'RUSD',
      '--json',
    ]);

    expect(nodeInfo).toHaveBeenCalledTimes(1);
    expect(sendPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        target_pubkey: '0xabcd',
        amount: '0x3e8',
        keysend: true,
        udt_type_script: { code_hash: '0x1234', hash_type: 'type', args: '0x5678' },
      }),
    );
  });

  it('still accepts a raw udt-type-script and includes it in sendPayment params', async () => {
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'send',
      '--to',
      '0xabcd',
      '--amount',
      '500',
      '--udt-type-script',
      '{"code_hash":"0xabcd","hash_type":"data","args":"0x"}',
      '--json',
    ]);

    expect(nodeInfo).not.toHaveBeenCalled();
    expect(sendPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        udt_type_script: { code_hash: '0xabcd', hash_type: 'data', args: '0x' },
      }),
    );
  });

  it('interprets amount as CKB when no UDT option is provided', async () => {
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'send',
      '--to',
      '0xabcd',
      '--amount',
      '1.5',
      '--json',
    ]);

    expect(nodeInfo).not.toHaveBeenCalled();
    const [params] = sendPayment.mock.calls[0];
    expect(params).toHaveProperty('amount', '0x8f0d180');
    expect(params).not.toHaveProperty('udt_type_script');
  });

  it('leaves max fee in CKB even for UDT payments', async () => {
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'send',
      '--to',
      '0xabcd',
      '--amount',
      '1000',
      '--udt-name',
      'RUSD',
      '--max-fee',
      '0.1',
      '--json',
    ]);

    const [params] = sendPayment.mock.calls[0];
    expect(params).toHaveProperty('amount', '0x3e8');
    expect(params).toHaveProperty('max_fee_amount', '0x989680');
    expect(params).toHaveProperty('udt_type_script');
  });

  it('JSON output includes unit UDT and resolved udtTypeScript', async () => {
    const { output, restore } = captureLogs();
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'send',
      '--to',
      '0xabcd',
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

  it('human output includes amount label CKB when no UDT option is provided', async () => {
    const { output, restore } = captureLogs();
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'send',
      '--to',
      '0xabcd',
      '--amount',
      '1.5',
    ]);
    restore();

    const joined = output.join('\n');
    expect(joined).toContain('Amount: 150000000 CKB');
  });

  it('human output includes amount label UDT and resolved UDT type script', async () => {
    const { output, restore } = captureLogs();
    const payment = createPaymentCommand(makeConfig());
    await payment.parseAsync([
      'node',
      'script',
      'send',
      '--to',
      '0xabcd',
      '--amount',
      '1000',
      '--udt-name',
      'RUSD',
    ]);
    restore();

    const joined = output.join('\n');
    expect(joined).toContain('Amount: 1000 RUSD');
    expect(joined).toContain('UDT Type Script:');
    expect(joined).toContain('"code_hash":"0x1234"');
    expect(joined).toContain('"hash_type":"type"');
    expect(joined).toContain('"args":"0x5678"');
  });
});
