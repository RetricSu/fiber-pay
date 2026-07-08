import { describe, expect, it } from 'vitest';
import {
  parseFundingAmount,
  parsePaymentAmount,
  parseUdtTypeScript,
} from '../src/lib/parse-options.js';

const ckbAsset = { kind: 'ckb' } as const;
const udtAsset = {
  kind: 'udt',
  script: { code_hash: '0x0', hash_type: 'type' as const, args: '0x' },
} as const;

describe('parseUdtTypeScript', () => {
  it('returns undefined when value is undefined', () => {
    expect(parseUdtTypeScript(undefined, '--funding-udt-type-script')).toBeUndefined();
  });

  it('parses a valid type script', () => {
    const raw = JSON.stringify({
      code_hash: '0x1234abcd',
      hash_type: 'type',
      args: '0x',
    });
    expect(parseUdtTypeScript(raw, '--funding-udt-type-script')).toEqual({
      code_hash: '0x1234abcd',
      hash_type: 'type',
      args: '0x',
    });
  });

  it('accepts all valid hash types', () => {
    for (const hashType of ['type', 'data', 'data1', 'data2']) {
      const raw = JSON.stringify({
        code_hash: '0x1234',
        hash_type: hashType,
        args: '0x5678',
      });
      expect(parseUdtTypeScript(raw, '--funding-udt-type-script')).toEqual({
        code_hash: '0x1234',
        hash_type: hashType,
        args: '0x5678',
      });
    }
  });

  it('throws when input is not valid JSON', () => {
    expect(() => parseUdtTypeScript('not-json', '--funding-udt-type-script')).toThrow(
      'must be a valid JSON object',
    );
  });

  it('throws when input is not an object', () => {
    expect(() => parseUdtTypeScript('[]', '--funding-udt-type-script')).toThrow(
      'must be a JSON object',
    );
  });

  it('throws when code_hash is missing', () => {
    const raw = JSON.stringify({ hash_type: 'type', args: '0x' });
    expect(() => parseUdtTypeScript(raw, '--funding-udt-type-script')).toThrow('code_hash');
  });

  it('throws when code_hash is not a hex string', () => {
    const raw = JSON.stringify({ code_hash: '1234', hash_type: 'type', args: '0x' });
    expect(() => parseUdtTypeScript(raw, '--funding-udt-type-script')).toThrow('code_hash');
  });

  it('throws when hash_type is invalid', () => {
    const raw = JSON.stringify({ code_hash: '0x1234', hash_type: 'invalid', args: '0x' });
    expect(() => parseUdtTypeScript(raw, '--funding-udt-type-script')).toThrow('hash_type');
  });

  it('throws when args is missing', () => {
    const raw = JSON.stringify({ code_hash: '0x1234', hash_type: 'type' });
    expect(() => parseUdtTypeScript(raw, '--funding-udt-type-script')).toThrow('args');
  });

  it('throws when args is not a hex string', () => {
    const raw = JSON.stringify({ code_hash: '0x1234', hash_type: 'type', args: 'abcd' });
    expect(() => parseUdtTypeScript(raw, '--funding-udt-type-script')).toThrow('args');
  });
});

describe('parseFundingAmount', () => {
  it('converts CKB amount to shannons', () => {
    expect(parseFundingAmount('1.5', ckbAsset)).toBe(150_000_000n);
    expect(parseFundingAmount('0', ckbAsset)).toBe(0n);
    expect(parseFundingAmount('100', ckbAsset)).toBe(10_000_000_000n);
  });

  it('parses UDT amount as raw integer', () => {
    expect(parseFundingAmount('1000', udtAsset)).toBe(1000n);
    expect(parseFundingAmount('0', udtAsset)).toBe(0n);
    expect(parseFundingAmount('12345678901234567890', udtAsset)).toBe(12345678901234567890n);
  });

  it('throws on negative CKB amount', () => {
    expect(() => parseFundingAmount('-1', ckbAsset)).toThrow('CKB funding amount');
  });

  it('throws on non-numeric CKB amount', () => {
    expect(() => parseFundingAmount('abc', ckbAsset)).toThrow('CKB funding amount');
  });

  it('throws on non-integer UDT amount', () => {
    expect(() => parseFundingAmount('1.5', udtAsset)).toThrow('UDT funding amount');
  });

  it('throws on negative UDT amount', () => {
    expect(() => parseFundingAmount('-1', udtAsset)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('-100', udtAsset)).toThrow('UDT funding amount');
  });

  it('throws on non-numeric UDT amount', () => {
    expect(() => parseFundingAmount('abc', udtAsset)).toThrow('UDT funding amount');
  });

  it('rejects empty or whitespace-only UDT amounts', () => {
    expect(() => parseFundingAmount('', udtAsset)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('   ', udtAsset)).toThrow('UDT funding amount');
  });

  it('rejects UDT amounts with surrounding whitespace, scientific notation, or illegal suffixes', () => {
    expect(() => parseFundingAmount(' 100', udtAsset)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('100 ', udtAsset)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount(' 100 ', udtAsset)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('1e2', udtAsset)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('100abc', udtAsset)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('+100', udtAsset)).toThrow('UDT funding amount');
  });

  it('parses CKB amounts with up to 8 decimal places exactly', () => {
    expect(parseFundingAmount('0.00000001', ckbAsset)).toBe(1n);
    expect(parseFundingAmount('123.45678901', ckbAsset)).toBe(12_345_678_901n);
  });

  it('throws on malformed or over-precise CKB amounts', () => {
    expect(() => parseFundingAmount('', ckbAsset)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('   ', ckbAsset)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount(' 1.5', ckbAsset)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('1.5 ', ckbAsset)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('Infinity', ckbAsset)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('NaN', ckbAsset)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('1abc', ckbAsset)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('1.2.3', ckbAsset)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('1e2', ckbAsset)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('0.123456789', ckbAsset)).toThrow('CKB funding amount');
  });
});

describe('parsePaymentAmount', () => {
  it('converts CKB amount to shannons', () => {
    expect(parsePaymentAmount('1.5', ckbAsset)).toBe(150_000_000n);
    expect(parsePaymentAmount('100', ckbAsset)).toBe(10_000_000_000n);
  });

  it('parses UDT amount as raw integer', () => {
    expect(parsePaymentAmount('1000', udtAsset)).toBe(1000n);
    expect(parsePaymentAmount('12345678901234567890', udtAsset)).toBe(12345678901234567890n);
  });

  it('throws on non-positive UDT amount', () => {
    expect(() => parsePaymentAmount('0', udtAsset)).toThrow('greater than 0');
    expect(() => parsePaymentAmount('-1', udtAsset)).toThrow('Invalid UDT amount');
  });

  it('throws on decimal UDT amount', () => {
    expect(() => parsePaymentAmount('1.5', udtAsset)).toThrow('Invalid UDT amount');
  });

  it('throws on non-positive CKB amount', () => {
    expect(() => parsePaymentAmount('0', ckbAsset)).toThrow('greater than 0');
    expect(() => parsePaymentAmount('-1', ckbAsset)).toThrow('Invalid CKB amount');
  });

  it('rejects malformed or over-precise CKB amounts', () => {
    expect(() => parsePaymentAmount('', ckbAsset)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount('   ', ckbAsset)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount(' 1.5', ckbAsset)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount('1.5 ', ckbAsset)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount('1.2.3', ckbAsset)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount('1e2', ckbAsset)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount('0.000000007', ckbAsset)).toThrow('Invalid CKB amount');
  });

  it('parses tiny CKB amounts exactly without floating-point error', () => {
    expect(parsePaymentAmount('0.00000007', ckbAsset)).toBe(7n);
  });
});
