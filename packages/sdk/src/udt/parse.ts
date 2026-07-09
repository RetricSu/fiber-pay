import type { HexString } from '../types/rpc.js';
import type { UdtAsset, UdtTypeScript } from './types.js';

const VALID_HASH_TYPES = new Set(['type', 'data', 'data1', 'data2']);
const SHANNONS_PER_CKB = 10n ** 8n;
const MAX_SCRIPT_JSON_LENGTH = 4096;
const CODE_HASH_LENGTH = 66; // 0x + 64 hex chars (32 bytes)
const MAX_ARGS_LENGTH = 2048; // 0x + up to 2046 hex chars

function validateHexString(
  value: unknown,
  optionName: string,
  field: string,
  exactLength?: number,
  maxLength?: number,
): asserts value is HexString {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`Invalid ${optionName}: ${field} must be a hex string starting with 0x`);
  }

  if (exactLength !== undefined && value.length !== exactLength) {
    throw new Error(`Invalid ${optionName}: ${field} must be ${exactLength} hex characters`);
  }

  if (maxLength !== undefined && value.length > maxLength) {
    throw new Error(`Invalid ${optionName}: ${field} exceeds maximum length of ${maxLength}`);
  }
}

function validateHashType(
  value: unknown,
  optionName: string,
): asserts value is UdtTypeScript['hash_type'] {
  if (typeof value !== 'string' || !VALID_HASH_TYPES.has(value)) {
    throw new Error(`Invalid ${optionName}: hash_type must be one of type, data, data1, data2`);
  }
}

/**
 * Validate a UDT type script object at runtime.
 *
 * @param value - Unknown value to validate.
 * @param optionName - Name of the option for error messages.
 * @returns Validated UdtTypeScript.
 */
export function validateUdtTypeScript(
  value: unknown,
  optionName = '--udt-type-script',
): UdtTypeScript {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${optionName}: must be an object with code_hash, hash_type, and args`);
  }

  const script = value as Record<string, unknown>;
  validateHexString(script.code_hash, optionName, 'code_hash', CODE_HASH_LENGTH);
  validateHashType(script.hash_type, optionName);
  validateHexString(script.args, optionName, 'args', undefined, MAX_ARGS_LENGTH);

  return {
    code_hash: script.code_hash,
    hash_type: script.hash_type,
    args: script.args,
  };
}

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

  if (value.length > MAX_SCRIPT_JSON_LENGTH) {
    throw new Error(
      `Invalid ${optionName}: input exceeds maximum length of ${MAX_SCRIPT_JSON_LENGTH}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid ${optionName}: must be a valid JSON object`);
  }

  return validateUdtTypeScript(parsed, optionName);
}

function normalizeCkbAmount(value: string): string {
  const trimmed = value.trim();
  const dotCount = (trimmed.match(/\./g) ?? []).length;
  if (dotCount > 1) {
    return trimmed;
  }
  const [integerPart, fractionalPart] = trimmed.split('.');
  if (fractionalPart === undefined) {
    return trimmed;
  }

  const strippedFraction = fractionalPart.replace(/0+$/, '');
  return strippedFraction.length === 0 ? integerPart : `${integerPart}.${strippedFraction}`;
}

function parseCkbAmount(value: string, allowZero: boolean, labelPrefix: string): bigint {
  const normalized = normalizeCkbAmount(value);
  if (!/^\d+(\.\d{1,8})?$/.test(normalized)) {
    throw new Error(
      `Invalid ${labelPrefix} amount: "${value}". Expected a ${allowZero ? 'non-negative' : 'positive'} number with at most 8 decimal places.`,
    );
  }

  const [integerPart, fractionalPart = ''] = normalized.split('.');
  const amount = BigInt(integerPart) * SHANNONS_PER_CKB + BigInt(fractionalPart.padEnd(8, '0'));
  if (!allowZero && amount <= 0n) {
    throw new Error('CKB amount must be greater than 0');
  }
  if (amount < 0n) {
    throw new Error(`Invalid ${labelPrefix} amount: "${value}". Expected a non-negative number.`);
  }
  return amount;
}

function parseUdtAmount(value: string, allowZero: boolean, labelPrefix: string): bigint {
  const signPattern = allowZero ? /^-?\d+$/ : /^\d+$/;
  if (!signPattern.test(value)) {
    throw new Error(
      `Invalid ${labelPrefix} amount: ${value}. Expected a ${allowZero ? 'non-negative' : 'positive'} integer in the smallest UDT unit.`,
    );
  }

  const amount = BigInt(value);
  if (!allowZero && amount <= 0n) {
    throw new Error('UDT amount must be greater than 0');
  }
  if (amount < 0n) {
    throw new Error(
      `Invalid ${labelPrefix} amount: ${value}. Expected a non-negative integer in the smallest UDT unit.`,
    );
  }
  return amount;
}

function validateAmountString(value: string, label: string, expected: string): void {
  if (value.trim() !== value || value.trim().length === 0) {
    throw new Error(`Invalid ${label}: "${value}". Expected a ${expected}.`);
  }
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
  const labelPrefix = isUdt ? 'UDT' : 'CKB';

  validateAmountString(value, `${labelPrefix} amount`, `positive ${isUdt ? 'integer' : 'number'}`);

  if (isUdt) {
    return parseUdtAmount(value, false, labelPrefix);
  }

  return parseCkbAmount(value, false, labelPrefix);
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
  const labelPrefix = isUdt ? 'UDT' : 'CKB';

  validateAmountString(
    value,
    `${labelPrefix} funding amount`,
    `non-negative ${isUdt ? 'integer' : 'number'}`,
  );

  if (isUdt) {
    return parseUdtAmount(value, true, `${labelPrefix} funding`);
  }

  return parseCkbAmount(value, true, `${labelPrefix} funding`);
}
