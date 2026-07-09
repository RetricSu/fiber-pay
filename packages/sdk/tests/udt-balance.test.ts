import { describe, expect, it } from 'vitest';
import { parseUdtAmountFromCellData } from '../src/browser/udt-balance.js';

describe('parseUdtAmountFromCellData', () => {
  it('parses little-endian UDT amount correctly', () => {
    // 0x0123456789abcdef in little-endian
    const data = '0xefcdab89674523010000000000000000';
    expect(parseUdtAmountFromCellData(data)).toBe(0x0123456789abcdefn);
  });

  it('parses zero amount', () => {
    expect(parseUdtAmountFromCellData('0x00000000000000000000000000000000')).toBe(0n);
  });

  it('returns null for non-hex data', () => {
    expect(parseUdtAmountFromCellData('not-hex')).toBeNull();
  });

  it('returns null for data without 0x prefix', () => {
    expect(parseUdtAmountFromCellData('efcdab89674523010000000000000000')).toBeNull();
  });

  it('returns null when amount segment has odd length', () => {
    expect(parseUdtAmountFromCellData('0xefcdab8967452301000000000000000')).toBeNull();
  });

  it('returns null when amount segment contains non-hex characters', () => {
    expect(parseUdtAmountFromCellData('0xefcdab8967452301000000000000000g')).toBeNull();
  });

  it('returns null when data is too short for 16 bytes', () => {
    expect(parseUdtAmountFromCellData('0xefcdab')).toBeNull();
  });

  it('ignores bytes beyond the first 16', () => {
    const data = '0xefcdab89674523010000000000000000aaaaaaaaaaaaaaaa';
    expect(parseUdtAmountFromCellData(data)).toBe(0x0123456789abcdefn);
  });
});
