import { describe, expect, it } from 'vitest';
import {
  extractFirstPidFromLsofOutput,
  isFiberRuntimeCommand,
  parsePortFromListen,
} from '../src/lib/runtime-port.js';

describe('runtime-port helpers', () => {
  it('parses port from host:port listen string', () => {
    expect(parsePortFromListen('127.0.0.1:8229')).toBe(8229);
    expect(parsePortFromListen('0.0.0.0:1')).toBe(1);
  });

  it('returns undefined for invalid listen strings', () => {
    expect(parsePortFromListen('')).toBeUndefined();
    expect(parsePortFromListen('localhost')).toBeUndefined();
    expect(parsePortFromListen('localhost:abc')).toBeUndefined();
    expect(parsePortFromListen('localhost:70000')).toBeUndefined();
  });

  it('extracts first pid from lsof machine output', () => {
    const output = ['p12345', 'f5', 'p23456'].join('\n');
    expect(extractFirstPidFromLsofOutput(output)).toBe(12345);
  });

  it('detects likely fiber runtime command line', () => {
    expect(isFiberRuntimeCommand('node /tmp/fiber-pay-cli.js runtime start --daemon')).toBe(true);
    expect(isFiberRuntimeCommand('fiber-pay runtime start --json')).toBe(true);
    expect(isFiberRuntimeCommand('node cli runtime start')).toBe(false);
    expect(isFiberRuntimeCommand('node server.js')).toBe(false);
  });
});
