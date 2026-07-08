import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInvoiceCommand } from '../src/commands/invoice.js';
import type { CliConfig } from '../src/lib/config.js';

const newInvoice = vi.fn().mockResolvedValue({
  invoice_address: 'fibt1...',
  invoice: { data: { payment_hash: '0xabc' } },
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
      newInvoice,
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

describe('invoice create UDT', () => {
  beforeEach(() => {
    newInvoice.mockClear();
    nodeInfo.mockClear();
  });

  it('creates a UDT invoice by name and sets udt_type_script', async () => {
    const invoice = createInvoiceCommand(makeConfig());

    await invoice.parseAsync([
      'node',
      'test',
      'create',
      '--amount',
      '1000',
      '--udt-name',
      'RUSD',
      '--json',
    ]);

    expect(nodeInfo).toHaveBeenCalledTimes(1);
    expect(newInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '0x3e8',
        udt_type_script: { code_hash: '0x1234', hash_type: 'type', args: '0x5678' },
      }),
    );
  });

  it('accepts a raw udt-type-script and includes it in newInvoice params', async () => {
    const invoice = createInvoiceCommand(makeConfig());

    await invoice.parseAsync([
      'node',
      'test',
      'create',
      '--amount',
      '500',
      '--udt-type-script',
      '{"code_hash":"0xabcd","hash_type":"data","args":"0x"}',
      '--json',
    ]);

    expect(nodeInfo).not.toHaveBeenCalled();
    expect(newInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '0x1f4',
        udt_type_script: { code_hash: '0xabcd', hash_type: 'data', args: '0x' },
      }),
    );
  });

  it('interprets amount as CKB when no UDT option is provided', async () => {
    const invoice = createInvoiceCommand(makeConfig());

    await invoice.parseAsync([
      'node',
      'test',
      'create',
      '--amount',
      '1.5',
      '--json',
    ]);

    expect(nodeInfo).not.toHaveBeenCalled();
    const [params] = newInvoice.mock.calls[0];
    expect(params).toHaveProperty('amount', '0x8f0d180');
    expect(params).not.toHaveProperty('udt_type_script');
  });

  it('rejects a decimal UDT amount', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    const { output, restore } = captureLogs();
    const invoice = createInvoiceCommand(makeConfig());

    await expect(
      invoice.parseAsync([
        'node',
        'test',
        'create',
        '--amount',
        '1.5',
        '--udt-name',
        'RUSD',
        '--json',
      ]),
    ).rejects.toThrow('process.exit(1)');

    restore();
    exitSpy.mockRestore();

    const json = JSON.parse(output.join('\n'));
    expect(json.success).toBe(false);
    expect(json.error.message).toContain('Invalid UDT amount');
    expect(newInvoice).not.toHaveBeenCalled();
  });

  it('JSON output includes unit UDT, amount, and resolved udtTypeScript', async () => {
    const { output, restore } = captureLogs();
    const invoice = createInvoiceCommand(makeConfig());

    await invoice.parseAsync([
      'node',
      'test',
      'create',
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
    expect(json.data.amount).toBe('1000');
    expect(json.data.udtTypeScript).toEqual({
      code_hash: '0x1234',
      hash_type: 'type',
      args: '0x5678',
    });
  });

  it('human output labels amount as CKB when no UDT option is provided', async () => {
    const { output, restore } = captureLogs();
    const invoice = createInvoiceCommand(makeConfig());

    await invoice.parseAsync(['node', 'test', 'create', '--amount', '1.5']);
    restore();

    const joined = output.join('\n');
    expect(joined).toContain('Amount:       1.5 CKB');
  });

  it('human output labels amount as UDT and prints resolved UDT type script', async () => {
    const { output, restore } = captureLogs();
    const invoice = createInvoiceCommand(makeConfig());

    await invoice.parseAsync([
      'node',
      'test',
      'create',
      '--amount',
      '1000',
      '--udt-name',
      'RUSD',
    ]);
    restore();

    const joined = output.join('\n');
    expect(joined).toContain('Amount:       1000 UDT');
    expect(joined).toContain('UDT Type Script:');
    expect(joined).toContain('"code_hash":"0x1234"');
    expect(joined).toContain('"hash_type":"type"');
    expect(joined).toContain('"args":"0x5678"');
  });
});
