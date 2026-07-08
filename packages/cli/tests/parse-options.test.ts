import { describe, expect, it } from 'vitest';
import {
  parseFundingAmount,
  parsePaymentAmount,
  parseUdtTypeScript,
} from '../src/lib/parse-options.js';

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
    expect(parseFundingAmount('1.5', false)).toBe(150_000_000n);
    expect(parseFundingAmount('0', false)).toBe(0n);
    expect(parseFundingAmount('100', false)).toBe(10_000_000_000n);
  });

  it('parses UDT amount as raw integer', () => {
    expect(parseFundingAmount('1000', true)).toBe(1000n);
    expect(parseFundingAmount('0', true)).toBe(0n);
    expect(parseFundingAmount('12345678901234567890', true)).toBe(12345678901234567890n);
  });

  it('throws on negative CKB amount', () => {
    expect(() => parseFundingAmount('-1', false)).toThrow('CKB funding amount');
  });

  it('throws on non-numeric CKB amount', () => {
    expect(() => parseFundingAmount('abc', false)).toThrow('CKB funding amount');
  });

  it('throws on non-integer UDT amount', () => {
    expect(() => parseFundingAmount('1.5', true)).toThrow('UDT funding amount');
  });

  it('throws on negative UDT amount', () => {
    expect(() => parseFundingAmount('-1', true)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('-100', true)).toThrow('UDT funding amount');
  });

  it('throws on non-numeric UDT amount', () => {
    expect(() => parseFundingAmount('abc', true)).toThrow('UDT funding amount');
  });

  it('rejects empty or whitespace-only UDT amounts', () => {
    expect(() => parseFundingAmount('', true)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('   ', true)).toThrow('UDT funding amount');
  });

  it('rejects UDT amounts with surrounding whitespace, scientific notation, or illegal suffixes', () => {
    expect(() => parseFundingAmount(' 100', true)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('100 ', true)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount(' 100 ', true)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('1e2', true)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('100abc', true)).toThrow('UDT funding amount');
    expect(() => parseFundingAmount('+100', true)).toThrow('UDT funding amount');
  });

  it('parses CKB amounts with up to 8 decimal places exactly', () => {
    expect(parseFundingAmount('0.00000001', false)).toBe(1n);
    expect(parseFundingAmount('123.45678901', false)).toBe(12_345_678_901n);
  });

  it('throws on malformed or over-precise CKB amounts', () => {
    expect(() => parseFundingAmount('', false)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('   ', false)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount(' 1.5', false)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('1.5 ', false)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('Infinity', false)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('NaN', false)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('1abc', false)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('1.2.3', false)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('1e2', false)).toThrow('CKB funding amount');
    expect(() => parseFundingAmount('0.123456789', false)).toThrow('CKB funding amount');
  });
});

describe('parsePaymentAmount', () => {
  it('converts CKB amount to shannons', () => {
    expect(parsePaymentAmount('1.5', false)).toBe(150_000_000n);
    expect(parsePaymentAmount('100', false)).toBe(10_000_000_000n);
  });

  it('parses UDT amount as raw integer', () => {
    expect(parsePaymentAmount('1000', true)).toBe(1000n);
    expect(parsePaymentAmount('12345678901234567890', true)).toBe(12345678901234567890n);
  });

  it('throws on non-positive UDT amount', () => {
    expect(() => parsePaymentAmount('0', true)).toThrow('greater than 0');
    expect(() => parsePaymentAmount('-1', true)).toThrow('Invalid UDT amount');
  });

  it('throws on decimal UDT amount', () => {
    expect(() => parsePaymentAmount('1.5', true)).toThrow('Invalid UDT amount');
  });

  it('throws on non-positive CKB amount', () => {
    expect(() => parsePaymentAmount('0', false)).toThrow('greater than 0');
    expect(() => parsePaymentAmount('-1', false)).toThrow('Invalid CKB amount');
  });

  it('rejects malformed or over-precise CKB amounts', () => {
    expect(() => parsePaymentAmount('', false)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount('   ', false)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount(' 1.5', false)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount('1.5 ', false)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount('1.2.3', false)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount('1e2', false)).toThrow('Invalid CKB amount');
    expect(() => parsePaymentAmount('0.000000007', false)).toThrow('Invalid CKB amount');
  });

  it('parses tiny CKB amounts exactly without floating-point error', () => {
    expect(parsePaymentAmount('0.00000007', false)).toBe(7n);
  });
});
