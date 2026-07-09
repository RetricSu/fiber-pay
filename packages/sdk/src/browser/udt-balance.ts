import type { Script } from '../types/rpc.js';
import { callJsonRpc, type IndexerCellsResponse } from './ckb-balance.js';

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 2000;

/**
 * Parse a UDT amount from cell output_data.
 *
 * UDT cells store the amount as the first 16 bytes of `output_data`, encoded
 * little-endian. This helper validates the data format, reverses the bytes to
 * big-endian, and returns the amount as a bigint.
 *
 * @param data - Cell output_data hex string.
 * @returns The parsed amount, or `null` if the data is malformed.
 */
export function parseUdtAmountFromCellData(data: string): bigint | null {
  if (typeof data !== 'string' || !data.startsWith('0x')) {
    return null;
  }

  // UDT amount is the first 16 bytes (32 hex chars) of cell data, little-endian.
  const amountHex = data.slice(2, 34);
  if (!/^[0-9a-fA-F]{32}$/.test(amountHex)) {
    return null;
  }

  // Reverse byte order (little-endian -> big-endian) and parse.
  let reversed = '';
  for (let i = amountHex.length - 2; i >= 0; i -= 2) {
    reversed += amountHex.slice(i, i + 2);
  }

  return BigInt(`0x${reversed}`);
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
      const amount = parseUdtAmountFromCellData(cell.output_data ?? '');
      if (amount !== null) {
        total += amount;
      }
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
