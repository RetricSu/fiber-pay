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

export function parsePaymentAmount(value: string, isUdt: boolean): bigint {
  if (value.trim() !== value || value.trim().length === 0) {
    throw new Error(
      `Invalid ${isUdt ? 'UDT' : 'CKB'} amount: "${value}". Expected a positive ${isUdt ? 'integer' : 'number'}.`,
    );
  }

  if (isUdt) {
    if (!/^\d+$/.test(value)) {
      throw new Error(`Invalid UDT amount "${value}": expected a non-negative integer`);
    }
    const amount = BigInt(value);
    if (amount <= 0n) {
      throw new Error('UDT amount must be greater than 0');
    }
    return amount;
  }

  if (!/^\d+(\.\d{1,8})?$/.test(value)) {
    throw new Error(
      `Invalid CKB amount: "${value}". Expected a positive number with at most 8 decimal places.`,
    );
  }
  const [integerPart, fractionalPart = ''] = value.split('.');
  const shannonsPerCkb = 10n ** 8n;
  const amount = BigInt(integerPart) * shannonsPerCkb + BigInt(fractionalPart.padEnd(8, '0'));
  if (amount <= 0n) {
    throw new Error('CKB amount must be greater than 0');
  }
  return amount;
}

export function parseFundingAmount(value: string, isUdt: boolean): bigint {
  if (value.trim() !== value || value.trim().length === 0) {
    throw new Error(
      `Invalid ${isUdt ? 'UDT' : 'CKB'} funding amount: ${value}. Expected a non-negative ${isUdt ? 'integer' : 'number'}.`,
    );
  }

  if (isUdt) {
    if (!/^-?\d+$/.test(value)) {
      throw new Error(
        `Invalid UDT funding amount: ${value}. Expected a non-negative integer in the smallest UDT unit.`,
      );
    }
    const amount = BigInt(value);
    if (amount < 0n) {
      throw new Error(
        `Invalid UDT funding amount: ${value}. Expected a non-negative integer in the smallest UDT unit.`,
      );
    }
    return amount;
  }

  // CKB is parsed as a fixed-point decimal with at most 8 decimal places (shannons).
  if (!/^\d+(\.\d{1,8})?$/.test(value)) {
    throw new Error(`Invalid CKB funding amount: ${value}. Expected a non-negative number.`);
  }
  const [integerPart, fractionalPart = ''] = value.split('.');
  const shannonsPerCkb = 10n ** 8n;
  return BigInt(integerPart) * shannonsPerCkb + BigInt(fractionalPart.padEnd(8, '0'));
}
