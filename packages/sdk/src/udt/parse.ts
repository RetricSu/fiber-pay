import type { HexString } from '../types/rpc.js';
import type { UdtAsset, UdtTypeScript } from './types.js';

const VALID_HASH_TYPES = new Set(['type', 'data', 'data1', 'data2']);
const SHANNONS_PER_CKB = 10n ** 8n;

/**
 * Parse a UDT type script from a JSON string.
 *
 * @param value - Raw JSON object string representing a CKB Script.
 * @param optionName - Name of the option for error messages.
 * @returns Parsed UdtTypeScript, or undefined if value is undefined.
 */
export function parseUdtTypeScript(
  value: string | undefined,
  optionName = '--udt-type-script',
): UdtTypeScript | undefined {
  if (value === undefined) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid ${optionName}: must be a valid JSON object`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `Invalid ${optionName}: must be a JSON object with code_hash, hash_type, and args`,
    );
  }

  const script = parsed as Record<string, unknown>;

  if (typeof script.code_hash !== 'string' || !/^0x[0-9a-fA-F]+$/.test(script.code_hash)) {
    throw new Error(`Invalid ${optionName}: code_hash must be a hex string starting with 0x`);
  }

  if (typeof script.hash_type !== 'string' || !VALID_HASH_TYPES.has(script.hash_type)) {
    throw new Error(`Invalid ${optionName}: hash_type must be one of type, data, data1, data2`);
  }

  if (typeof script.args !== 'string' || !/^0x[0-9a-fA-F]*$/.test(script.args)) {
    throw new Error(`Invalid ${optionName}: args must be a hex string starting with 0x`);
  }

  return {
    code_hash: script.code_hash as HexString,
    hash_type: script.hash_type as UdtTypeScript['hash_type'],
    args: script.args as HexString,
  };
}

/**
 * Parse a payment amount for either CKB or UDT.
 *
 * CKB amounts are decimal numbers with up to 8 decimal places and returned in shannons.
 * UDT amounts are plain integers in the smallest UDT unit.
 *
 * @param value - Human-readable amount string.
 * @param asset - Asset descriptor (CKB or UDT).
 * @returns Amount in raw on-chain units.
 */
export function parsePaymentAmount(value: string, asset: UdtAsset): bigint {
  const isUdt = asset.kind === 'udt';

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
  const amount = BigInt(integerPart) * SHANNONS_PER_CKB + BigInt(fractionalPart.padEnd(8, '0'));
  if (amount <= 0n) {
    throw new Error('CKB amount must be greater than 0');
  }
  return amount;
}

/**
 * Parse a funding amount for either CKB or UDT.
 *
 * Unlike payment amounts, funding amounts may be zero (e.g., one-way channels).
 *
 * @param value - Human-readable amount string.
 * @param asset - Asset descriptor (CKB or UDT).
 * @returns Amount in raw on-chain units.
 */
export function parseFundingAmount(value: string, asset: UdtAsset): bigint {
  const isUdt = asset.kind === 'udt';

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

  if (!/^\d+(\.\d{1,8})?$/.test(value)) {
    throw new Error(`Invalid CKB funding amount: ${value}. Expected a non-negative number.`);
  }
  const [integerPart, fractionalPart = ''] = value.split('.');
  return BigInt(integerPart) * SHANNONS_PER_CKB + BigInt(fractionalPart.padEnd(8, '0'));
}
