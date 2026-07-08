import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChannelCommand } from '../src/commands/channel.js';

const openChannel = vi.fn().mockResolvedValue({ temporary_channel_id: '0x1234' });
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
      openChannel,
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

describe('channel open UDT resolution', () => {
  beforeEach(() => {
    openChannel.mockClear();
    nodeInfo.mockClear();
  });

  it('resolves a UDT by name and includes funding_udt_type_script in openChannel params', async () => {
    const channel = createChannelCommand(makeConfig());
    await channel.parseAsync([
      'node',
      'script',
      'open',
      '--peer',
      '0xabcd',
      '--funding',
      '1000',
      '--funding-udt-name',
      'RUSD',
      '--json',
    ]);

    expect(nodeInfo).toHaveBeenCalledTimes(1);
    expect(openChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        pubkey: '0xabcd',
        funding_amount: '0x3e8',
        funding_udt_type_script: { code_hash: '0x1234', hash_type: 'type', args: '0x5678' },
      }),
    );
  });

  it('still accepts a raw funding-udt-type-script and includes it in openChannel params', async () => {
    const channel = createChannelCommand(makeConfig());
    await channel.parseAsync([
      'node',
      'script',
      'open',
      '--peer',
      '0xabcd',
      '--funding',
      '500',
      '--funding-udt-type-script',
      '{"code_hash":"0xabcd","hash_type":"data","args":"0x"}',
      '--json',
    ]);

    expect(nodeInfo).not.toHaveBeenCalled();
    expect(openChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        funding_udt_type_script: { code_hash: '0xabcd', hash_type: 'data', args: '0x' },
      }),
    );
  });

  it('opens a CKB channel when no UDT option is provided', async () => {
    const channel = createChannelCommand(makeConfig());
    await channel.parseAsync([
      'node',
      'script',
      'open',
      '--peer',
      '0xabcd',
      '--funding',
      '1.5',
      '--json',
    ]);

    expect(nodeInfo).not.toHaveBeenCalled();
    const [params] = openChannel.mock.calls[0];
    expect(params).toHaveProperty('funding_amount', '0x8f0d180');
    expect(params).not.toHaveProperty('funding_udt_type_script');
  });

  it('JSON output includes fundingLabel UDT and resolved fundingUdtTypeScript', async () => {
    const { output, restore } = captureLogs();
    const channel = createChannelCommand(makeConfig());
    await channel.parseAsync([
      'node',
      'script',
      'open',
      '--peer',
      '0xabcd',
      '--funding',
      '1000',
      '--funding-udt-name',
      'RUSD',
      '--json',
    ]);
    restore();

    const json = JSON.parse(output.join('\n'));
    expect(json.success).toBe(true);
    expect(json.data.fundingLabel).toBe('UDT');
    expect(json.data.fundingUdtTypeScript).toEqual({
      code_hash: '0x1234',
      hash_type: 'type',
      args: '0x5678',
    });
  });

  it('human output includes fundingLabel CKB when no UDT option is provided', async () => {
    const { output, restore } = captureLogs();
    const channel = createChannelCommand(makeConfig());
    await channel.parseAsync([
      'node',
      'script',
      'open',
      '--peer',
      '0xabcd',
      '--funding',
      '1.5',
    ]);
    restore();

    const joined = output.join('\n');
    expect(joined).toContain('Funding:              150000000 CKB');
  });

  it('human output includes fundingLabel UDT and resolved UDT type script', async () => {
    const { output, restore } = captureLogs();
    const channel = createChannelCommand(makeConfig());
    await channel.parseAsync([
      'node',
      'script',
      'open',
      '--peer',
      '0xabcd',
      '--funding',
      '1000',
      '--funding-udt-name',
      'RUSD',
    ]);
    restore();

    const joined = output.join('\n');
    expect(joined).toContain('Funding:              1000 UDT');
    expect(joined).toContain('UDT Type Script:');
    expect(joined).toContain('"code_hash":"0x1234"');
    expect(joined).toContain('"hash_type":"type"');
    expect(joined).toContain('"args":"0x5678"');
  });
});
