import {
  collectBiscuitPermissions,
  getBiscuitRuleForMethod,
  listSupportedBiscuitMethods,
  renderBiscuitFactsForMethods,
  renderBiscuitPermissionFacts,
} from '../src/security/biscuit-policy.js';
import { describe, expect, it } from 'vitest';

describe('biscuit policy helper', () => {
  it('returns rule for known method', () => {
    const rule = getBiscuitRuleForMethod('send_payment');
    expect(rule).toBeDefined();
    expect(rule?.permissions).toEqual([{ action: 'write', resource: 'payments' }]);
    expect(rule?.requiresChannelRight).toBe(false);
  });

  it('collects and deduplicates permissions from methods', () => {
    const permissions = collectBiscuitPermissions([
      'send_payment',
      'send_payment_with_router',
      'get_payment',
      'list_peers',
      'disconnect_peer',
      'unknown_method',
    ]);

    expect(permissions).toEqual([
      { action: 'read', resource: 'payments' },
      { action: 'read', resource: 'peers' },
      { action: 'write', resource: 'payments' },
      { action: 'write', resource: 'peers' },
    ]);
  });

  it('renders permission facts in datalog style', () => {
    const output = renderBiscuitPermissionFacts([
      { action: 'read', resource: 'peers' },
      { action: 'write', resource: 'payments' },
    ]);

    expect(output).toBe('read("peers");\nwrite("payments");');
  });

  it('escapes special characters in resource names', () => {
    const output = renderBiscuitPermissionFacts([{ action: 'read', resource: 'chan"nel\\ops' }]);

    expect(output).toBe('read("chan\\"nel\\\\ops");');
  });

  it('renders facts directly from methods', () => {
    const output = renderBiscuitFactsForMethods(['open_channel', 'list_channels']);
    expect(output).toBe('read("channels");\nwrite("channels");');
  });

  it('marks watchtower channel-scoped methods as requiring channel rights', () => {
    const rule = getBiscuitRuleForMethod('update_revocation');
    expect(rule?.requiresChannelRight).toBe(true);
  });

  it('lists supported method names', () => {
    const methods = listSupportedBiscuitMethods();
    expect(methods).toContain('send_payment');
    expect(methods).toContain('list_peers');
    expect(methods).toContain('update_revocation');
  });
});
