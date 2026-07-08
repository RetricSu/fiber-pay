import {
  parseFundingAmount as parseFundingAmountSdk,
  parsePaymentAmount as parsePaymentAmountSdk,
  parseUdtTypeScript as parseUdtTypeScriptSdk,
  type UdtAsset,
  type UdtTypeScript,
} from '@fiber-pay/sdk';

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

export type { UdtTypeScript };

export function parseUdtTypeScript(
  value: string | undefined,
  name: string,
): UdtTypeScript | undefined {
  return parseUdtTypeScriptSdk(value, name);
}

export function parsePaymentAmount(value: string, isUdt: boolean): bigint {
  const asset: UdtAsset = isUdt ? { kind: 'udt', script: {} as UdtTypeScript } : { kind: 'ckb' };
  return parsePaymentAmountSdk(value, asset);
}

export function parseFundingAmount(value: string, isUdt: boolean): bigint {
  const asset: UdtAsset = isUdt ? { kind: 'udt', script: {} as UdtTypeScript } : { kind: 'ckb' };
  return parseFundingAmountSdk(value, asset);
}
