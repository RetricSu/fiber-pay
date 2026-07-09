import type { Script } from '../types/rpc.js';

const SHANNONS_PER_CKB = 100_000_000n;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 2000;

interface IndexerCellsResponse {
  objects?: Array<{ output?: { capacity?: string }; output_data?: string }>;
  last_cursor?: string;
}

export async function callJsonRpc<TResult>(
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

export async function getLockBalanceShannons(
  ckbRpcUrl: string,
  lockScript: Script,
  options?: { pageSize?: number; maxPages?: number },
): Promise<bigint> {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const limitHex = `0x${pageSize.toString(16)}`;

  let cursor: string | undefined;
  let total = 0n;

  for (let i = 0; i < maxPages; i++) {
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
    if (!nextCursor || nextCursor === cursor || cells.length < pageSize) {
      break;
    }

    if (i === maxPages - 1) {
      throw new Error('Maximum pages reached while fetching balance. Result is incomplete.');
    }

    cursor = nextCursor;
  }

  return total;
}

export async function getUdtBalance(
  ckbRpcUrl: string,
  lockScript: Script,
  udtTypeScript: Script,
  options?: { pageSize?: number; maxPages?: number },
): Promise<bigint> {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const limitHex = `0x${pageSize.toString(16)}`;

  let cursor: string | undefined;
  let total = 0n;

  for (let i = 0; i < maxPages; i++) {
    const params: unknown[] = [
      {
        script: lockScript,
        script_type: 'lock',
        filter: { script: udtTypeScript, script_type: 'type' },
        script_search_mode: 'exact',
      },
      'asc',
      limitHex,
    ];
    if (cursor) {
      params.push(cursor);
    }

    const page = await callJsonRpc<IndexerCellsResponse>(ckbRpcUrl, 'get_cells', params);
    const cells = page.objects ?? [];

    for (const cell of cells) {
      const data = cell.output_data;
      if (typeof data !== 'string' || !data.startsWith('0x')) {
        continue;
      }
      // UDT amount is the first 16 bytes (32 hex chars) of cell data, little-endian.
      const amountHex = data.slice(2, 34);
      if (amountHex.length === 0) {
        continue;
      }
      let amount = 0n;
      for (let j = 0; j < amountHex.length; j += 2) {
        amount =
          (amount << 8n) |
          BigInt(parseInt(amountHex.slice(amountHex.length - 2 - j, amountHex.length - j), 16));
      }
      total += amount;
    }

    const nextCursor = page.last_cursor;
    if (!nextCursor || nextCursor === cursor || cells.length < pageSize) {
      break;
    }

    if (i === maxPages - 1) {
      throw new Error('Maximum pages reached while fetching UDT balance. Result is incomplete.');
    }

    cursor = nextCursor;
  }

  return total;
}

export function formatShannonsAsCkb(shannons: bigint | string, fractionDigits = 8): string {
  const value = typeof shannons === 'bigint' ? shannons : BigInt(shannons);
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const safeDigits = Math.max(0, Math.min(8, Math.trunc(fractionDigits)));
  const multiplier = 10n ** BigInt(safeDigits);
  const scaled = (absolute * multiplier + SHANNONS_PER_CKB / 2n) / SHANNONS_PER_CKB;
  const whole = scaled / multiplier;

  if (safeDigits === 0) {
    return `${sign}${whole}`;
  }

  const fraction = (scaled % multiplier).toString().padStart(safeDigits, '0');
  return `${sign}${whole}.${fraction}`;
}
