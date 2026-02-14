import { existsSync, readFileSync } from 'node:fs';
import { ChannelState, type Script, scriptToAddress } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printBalanceHuman, printJson } from '../lib/format.js';
import { createReadyRpcClient } from '../lib/rpc.js';

const CELLS_PAGE_SIZE = 100;

interface IndexerCellsResponse {
  objects: Array<{ output?: { capacity?: string } }>;
  last_cursor?: string;
}

function parseCkbRpcUrlFromConfig(configPath: string): string | undefined {
  if (!existsSync(configPath)) return undefined;

  const content = readFileSync(configPath, 'utf-8');
  const ckbSectionMatch = content.match(/(^|\n)ckb:\n([\s\S]*?)(\n[a-zA-Z_]+:|\nservices:|$)/);
  const ckbSection = ckbSectionMatch?.[2];
  if (!ckbSection) return undefined;

  const match = ckbSection.match(/^\s*rpc_url:\s*"?([^"\n]+)"?\s*$/m);
  return match?.[1]?.trim() || undefined;
}

async function callJsonRpc<TResult>(
  url: string,
  method: string,
  params: unknown[],
): Promise<TResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    result?: TResult;
    error?: { message?: string; code?: number };
  };

  if (payload.error) {
    const code = payload.error.code ?? 'unknown';
    const message = payload.error.message ?? 'JSON-RPC error';
    throw new Error(`${message} (code: ${code})`);
  }

  if (payload.result === undefined) {
    throw new Error('Missing JSON-RPC result');
  }

  return payload.result;
}

async function getLockBalanceShannons(ckbRpcUrl: string, lockScript: Script): Promise<bigint> {
  let cursor: string | undefined;
  let total = 0n;
  const limitHex = `0x${CELLS_PAGE_SIZE.toString(16)}`;

  for (let i = 0; i < 2000; i++) {
    const params: unknown[] = [{ script: lockScript, script_type: 'lock' }, 'asc', limitHex];
    if (cursor) {
      params.push(cursor);
    }

    const page = await callJsonRpc<IndexerCellsResponse>(ckbRpcUrl, 'get_cells', params);
    const cells = page.objects ?? [];

    for (const cell of cells) {
      if (cell.output?.capacity) {
        total += BigInt(cell.output.capacity);
      }
    }

    const nextCursor = page.last_cursor;
    if (!nextCursor || nextCursor === cursor || cells.length < CELLS_PAGE_SIZE) {
      break;
    }
    cursor = nextCursor;
  }

  return total;
}

export function createBalanceCommand(config: CliConfig): Command {
  return new Command('balance')
    .description('Get current balance information')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const nodeInfo = await rpc.nodeInfo();
      const channels = await rpc.listChannels({});
      let totalLocal = 0n;
      let totalRemote = 0n;
      let activeChannelCount = 0;

      for (const ch of channels.channels) {
        if (ch.state?.state_name === ChannelState.ChannelReady) {
          totalLocal += BigInt(ch.local_balance);
          totalRemote += BigInt(ch.remote_balance);
          activeChannelCount++;
        }
      }

      const fundingAddress = scriptToAddress(nodeInfo.default_funding_lock_script, config.network);
      const ckbRpcUrl =
        process.env.FIBER_CKB_RPC_URL || parseCkbRpcUrlFromConfig(config.configPath);
      let fundingBalance = 0n;
      let fundingBalanceError: string | undefined;

      if (ckbRpcUrl) {
        try {
          fundingBalance = await getLockBalanceShannons(
            ckbRpcUrl,
            nodeInfo.default_funding_lock_script,
          );
        } catch (error) {
          fundingBalanceError =
            error instanceof Error
              ? error.message
              : 'Failed to query CKB balance for funding address';
        }
      } else {
        fundingBalanceError =
          'CKB RPC URL not configured (set ckb.rpc_url in config.yml or FIBER_CKB_RPC_URL)';
      }

      const localCkb = Number(totalLocal) / 1e8;
      const remoteCkb = Number(totalRemote) / 1e8;
      const fundingCkb = Number(fundingBalance) / 1e8;

      const output = {
        totalCkb: localCkb + fundingCkb,
        channelLocalCkb: localCkb,
        availableToSend: localCkb,
        availableToReceive: remoteCkb,
        channelCount: channels.channels.length,
        activeChannelCount,
        fundingAddress,
        fundingAddressTotalCkb: fundingCkb,
        fundingBalanceError,
      };

      if (options.json) {
        printJson({ success: true, data: output });
      } else {
        printBalanceHuman(output);
      }
    });
}
