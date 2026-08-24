import {
  collectBiscuitPermissions,
  getBiscuitRuleForMethod,
  listSupportedBiscuitMethods,
  renderBiscuitFactsForMethods,
  renderBiscuitPermissionFacts,
} from '../src/security/biscuit-policy.js';
import type { BiscuitMethodRule } from '../src/security/biscuit-policy.js';
import { describe, expect, it } from 'vitest';
import { FNN_V0_9_0_RULES } from './fixtures/fnn-biscuit-rules.js';

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
    expect(methods).toContain('open_channel_with_external_funding');
    expect(methods).toContain('submit_signed_funding_tx');
  });

  it('maps external funding channel methods to channel write permission', () => {
    const openRule = getBiscuitRuleForMethod('open_channel_with_external_funding');
    const submitRule = getBiscuitRuleForMethod('submit_signed_funding_tx');

    expect(openRule?.permissions).toEqual([{ action: 'write', resource: 'channels' }]);
    expect(openRule?.requiresChannelRight).toBe(false);
    expect(submitRule?.permissions).toEqual([{ action: 'write', resource: 'channels' }]);
    expect(submitRule?.requiresChannelRight).toBe(false);
  });

  it('requires write("cch") for receive_btc (fnn v0.9.0)', () => {
    const rule = getBiscuitRuleForMethod('receive_btc');
    expect(rule?.permissions).toEqual([{ action: 'write', resource: 'cch' }]);
  });

  it('scopes dev methods to write("dev") (fnn v0.9.0)', () => {
    const devMethods = [
      'commitment_signed',
      'add_tlc',
      'remove_tlc',
      'check_channel_shutdown',
      'sign_external_funding_tx',
      'submit_commitment_transaction',
    ];

    for (const method of devMethods) {
      expect(getBiscuitRuleForMethod(method)?.permissions).toEqual([
        { action: 'write', resource: 'dev' },
      ]);
    }
  });

  it('grants read("cch") alongside write("cch") by default', () => {
    // fnn v0.9.0: get_cch_order still needs read("cch"), and pre-v0.9.0 nodes
    // require read("cch") for receive_btc — a write-only cch token is broken
    // in practice on both.
    expect(collectBiscuitPermissions(['receive_btc'])).toEqual([
      { action: 'read', resource: 'cch' },
      { action: 'write', resource: 'cch' },
    ]);
    expect(renderBiscuitFactsForMethods(['send_btc'])).toBe('read("cch");\nwrite("cch");');
  });

  it('can opt out of the cch read compat grant', () => {
    expect(collectBiscuitPermissions(['receive_btc'], { cchReadCompat: false })).toEqual([
      { action: 'write', resource: 'cch' },
    ]);
    expect(renderBiscuitFactsForMethods(['send_btc'], { cchReadCompat: false })).toBe(
      'write("cch");',
    );
  });

  it('does not add write("cch") for read-only cch methods', () => {
    expect(collectBiscuitPermissions(['get_cch_order'])).toEqual([
      { action: 'read', resource: 'cch' },
    ]);
  });

  it('deliberately omits non-mintable or fail-closed upstream methods', () => {
    // subscribe_store_changes requires the node-internal
    // internal("store_changes") scope; backup_now is registered upstream
    // under a rule key that does not match the RPC method name (`backup`).
    expect(getBiscuitRuleForMethod('subscribe_store_changes')).toBeUndefined();
    expect(getBiscuitRuleForMethod('backup_now')).toBeUndefined();
    expect(getBiscuitRuleForMethod('backup')).toBeUndefined();
  });

  it('RULES mirrors the fnn v0.9.0 upstream rule table', () => {
    const actual: Record<string, BiscuitMethodRule> = {};
    for (const method of listSupportedBiscuitMethods()) {
      const rule = getBiscuitRuleForMethod(method);
      if (rule) actual[method] = rule;
    }

    expect(actual).toEqual(FNN_V0_9_0_RULES);
  });
});
