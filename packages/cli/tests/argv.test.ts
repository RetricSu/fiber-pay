import { describe, expect, it } from 'vitest';
import { isTopLevelVersionRequest } from '../src/lib/argv.js';

describe('isTopLevelVersionRequest', () => {
  it('matches plain top-level --version', () => {
    expect(isTopLevelVersionRequest(['node', 'cli', '--version'])).toBe(true);
  });

  it('matches plain top-level -v', () => {
    expect(isTopLevelVersionRequest(['node', 'cli', '-v'])).toBe(true);
  });

  it('returns false when a subcommand is present', () => {
    expect(isTopLevelVersionRequest(['node', 'cli', 'node', 'status', '--json'])).toBe(false);
  });

  it('returns false for positional version command', () => {
    expect(isTopLevelVersionRequest(['node', 'cli', 'version'])).toBe(false);
  });

  it('keeps top-level behavior when --profile value equals a command name', () => {
    expect(isTopLevelVersionRequest(['node', 'cli', '--profile', 'node', '--version'])).toBe(true);
  });

  it('keeps top-level behavior for inline global option values', () => {
    expect(isTopLevelVersionRequest(['node', 'cli', '--profile=node', '--version'])).toBe(true);
  });

  it('returns false after terminator when --version is positional', () => {
    expect(isTopLevelVersionRequest(['node', 'cli', '--', '--version'])).toBe(false);
  });

  it('returns false for unknown positional arguments even with --version', () => {
    expect(isTopLevelVersionRequest(['node', 'cli', 'foo', '--version'])).toBe(false);
  });
});
