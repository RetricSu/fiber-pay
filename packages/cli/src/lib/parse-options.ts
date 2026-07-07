import type { HexString } from '@fiber-pay/sdk';

export function parseIntegerOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}. Expected positive integer.`);
  }
  return parsed;
}

export function parseBoolOption(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Invalid ${name}: ${value}. Expected true|false.`);
}

const VALID_HASH_TYPES = new Set(['type', 'data', 'data1', 'data2']);

export interface UdtTypeScript {
  code_hash: HexString;
  hash_type: 'type' | 'data' | 'data1' | 'data2';
  args: HexString;
}

export function parseUdtTypeScript(
  value: string | undefined,
  name: string,
): UdtTypeScript | undefined {
  if (value === undefined) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid ${name}: must be a valid JSON object`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${name}: must be a JSON object with code_hash, hash_type, and args`);
  }

  const script = parsed as Record<string, unknown>;

  if (typeof script.code_hash !== 'string' || !/^0x[0-9a-fA-F]+$/.test(script.code_hash)) {
    throw new Error(`Invalid ${name}: code_hash must be a hex string starting with 0x`);
  }

  if (typeof script.hash_type !== 'string' || !VALID_HASH_TYPES.has(script.hash_type)) {
    throw new Error(`Invalid ${name}: hash_type must be one of type, data, data1, data2`);
  }

  if (typeof script.args !== 'string' || !/^0x[0-9a-fA-F]*$/.test(script.args)) {
    throw new Error(`Invalid ${name}: args must be a hex string starting with 0x`);
  }

  return {
    code_hash: script.code_hash as HexString,
    hash_type: script.hash_type as UdtTypeScript['hash_type'],
    args: script.args as HexString,
  };
}

export function parseFundingAmount(value: string, isUdt: boolean): bigint {
  if (isUdt) {
    try {
      const amount = BigInt(value);
      if (amount < 0n) {
        throw new Error();
      }
      return amount;
    } catch {
      throw new Error(
        `Invalid UDT funding amount: ${value}. Expected a non-negative integer in the smallest UDT unit.`,
      );
    }
  }

  const parsed = parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid CKB funding amount: ${value}. Expected a non-negative number.`);
  }
  return BigInt(Math.floor(parsed * 1e8));
}
