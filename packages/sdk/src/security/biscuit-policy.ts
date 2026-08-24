/**
 * Biscuit policy helpers for Fiber RPC.
 *
 * These helpers model the upstream RPC authorization rules and generate
 * token-side permission facts like `read("peers");` and `write("payments");`.
 *
 * The RULES table mirrors fnn v0.9.0 `build_rules()`
 * (crates/fiber-lib/src/rpc/biscuit.rs @ v0.9.0, also documented in upstream
 * docs/biscuit-auth.md), with two deliberate omissions:
 *
 * - `subscribe_store_changes`: upstream requires `internal("store_changes")`,
 *   a node-internal scope that user-minted tokens must not carry.
 * - `backup_now`: upstream registers the rule under the key `backup_now`
 *   while the RPC method is named `backup`, so authenticated calls are
 *   fail-closed regardless of token contents ("no rules for method").
 *
 * Biscuit `read` and `write` do not imply each other, so
 * `collectBiscuitPermissions` by default also grants `read("cch")` whenever
 * `write("cch")` is collected: on fnn v0.9.0 a write-only cch token cannot
 * call `get_cch_order`, and on pre-v0.9.0 nodes `receive_btc` still requires
 * `read("cch")`. Pass `{ cchReadCompat: false }` to opt out.
 */

export type BiscuitAction = 'read' | 'write';

export interface BiscuitPermission {
  action: BiscuitAction;
  resource: string;
}

export interface BiscuitMethodRule {
  permissions: BiscuitPermission[];
  requiresChannelRight: boolean;
}

export interface CollectBiscuitPermissionsOptions {
  /**
   * Also grant `read("cch")` whenever `write("cch")` is collected.
   *
   * Defaults to true so that cch-mutating tokens can still query their own
   * orders via `get_cch_order` (requires `read("cch")` on every fnn version)
   * and keep working for `receive_btc` on pre-v0.9.0 nodes.
   */
  cchReadCompat?: boolean;
}

const RULES: Record<string, BiscuitMethodRule> = {
  // Cch
  send_btc: {
    permissions: [{ action: 'write', resource: 'cch' }],
    requiresChannelRight: false,
  },
  receive_btc: {
    permissions: [{ action: 'write', resource: 'cch' }],
    requiresChannelRight: false,
  },
  get_cch_order: {
    permissions: [{ action: 'read', resource: 'cch' }],
    requiresChannelRight: false,
  },
  // Omitted vs upstream: subscribe_store_changes requires the node-internal
  // internal("store_changes") scope, which user-minted tokens must not carry.

  // Channel
  open_channel: {
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  accept_channel: {
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  abandon_channel: {
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  list_channels: {
    permissions: [{ action: 'read', resource: 'channels' }],
    requiresChannelRight: false,
  },
  shutdown_channel: {
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  update_channel: {
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  open_channel_with_external_funding: {
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  submit_signed_funding_tx: {
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },

  // Dev
  commitment_signed: {
    permissions: [{ action: 'write', resource: 'dev' }],
    requiresChannelRight: false,
  },
  add_tlc: {
    permissions: [{ action: 'write', resource: 'dev' }],
    requiresChannelRight: false,
  },
  remove_tlc: {
    permissions: [{ action: 'write', resource: 'dev' }],
    requiresChannelRight: false,
  },
  check_channel_shutdown: {
    permissions: [{ action: 'write', resource: 'dev' }],
    requiresChannelRight: false,
  },
  sign_external_funding_tx: {
    permissions: [{ action: 'write', resource: 'dev' }],
    requiresChannelRight: false,
  },
  submit_commitment_transaction: {
    permissions: [{ action: 'write', resource: 'dev' }],
    requiresChannelRight: false,
  },

  // Pprof
  pprof: {
    permissions: [{ action: 'write', resource: 'pprof' }],
    requiresChannelRight: false,
  },

  // Graph
  graph_nodes: {
    permissions: [{ action: 'read', resource: 'graph' }],
    requiresChannelRight: false,
  },
  graph_channels: {
    permissions: [{ action: 'read', resource: 'graph' }],
    requiresChannelRight: false,
  },

  // Info
  node_info: {
    permissions: [{ action: 'read', resource: 'node' }],
    requiresChannelRight: false,
  },
  // Omitted vs upstream: backup_now (write("node")) is registered under a
  // rule key that does not match the RPC method name (`backup`), so
  // authenticated calls are fail-closed regardless of token contents.

  // Invoice
  new_invoice: {
    permissions: [{ action: 'write', resource: 'invoices' }],
    requiresChannelRight: false,
  },
  parse_invoice: {
    permissions: [{ action: 'read', resource: 'invoices' }],
    requiresChannelRight: false,
  },
  get_invoice: {
    permissions: [{ action: 'read', resource: 'invoices' }],
    requiresChannelRight: false,
  },
  cancel_invoice: {
    permissions: [{ action: 'write', resource: 'invoices' }],
    requiresChannelRight: false,
  },
  settle_invoice: {
    permissions: [{ action: 'write', resource: 'invoices' }],
    requiresChannelRight: false,
  },

  // Payment
  send_payment: {
    permissions: [{ action: 'write', resource: 'payments' }],
    requiresChannelRight: false,
  },
  get_payment: {
    permissions: [{ action: 'read', resource: 'payments' }],
    requiresChannelRight: false,
  },
  list_payments: {
    permissions: [{ action: 'read', resource: 'payments' }],
    requiresChannelRight: false,
  },
  build_router: {
    permissions: [{ action: 'read', resource: 'payments' }],
    requiresChannelRight: false,
  },
  send_payment_with_router: {
    permissions: [{ action: 'write', resource: 'payments' }],
    requiresChannelRight: false,
  },

  // Peer
  connect_peer: {
    permissions: [{ action: 'write', resource: 'peers' }],
    requiresChannelRight: false,
  },
  disconnect_peer: {
    permissions: [{ action: 'write', resource: 'peers' }],
    requiresChannelRight: false,
  },
  list_peers: {
    permissions: [{ action: 'read', resource: 'peers' }],
    requiresChannelRight: false,
  },

  // Watchtower
  create_watch_channel: {
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: true,
  },
  remove_watch_channel: {
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: true,
  },
  update_revocation: {
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: true,
  },
  update_local_settlement: {
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: true,
  },
  update_pending_remote_settlement: {
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: true,
  },
  create_preimage: {
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: false,
  },
  remove_preimage: {
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: false,
  },
};

function escapeDatalogString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function getBiscuitRuleForMethod(method: string): BiscuitMethodRule | undefined {
  return RULES[method];
}

export function collectBiscuitPermissions(
  methods: string[],
  options: CollectBiscuitPermissionsOptions = {},
): BiscuitPermission[] {
  const { cchReadCompat = true } = options;
  const dedup = new Map<string, BiscuitPermission>();

  for (const method of methods) {
    const rule = RULES[method];
    if (!rule) continue;

    for (const permission of rule.permissions) {
      const key = `${permission.action}:${permission.resource}`;
      if (!dedup.has(key)) {
        dedup.set(key, permission);
      }
    }
  }

  if (cchReadCompat && dedup.has('write:cch') && !dedup.has('read:cch')) {
    dedup.set('read:cch', { action: 'read', resource: 'cch' });
  }

  return [...dedup.values()].sort((a, b) => {
    if (a.action === b.action) {
      return a.resource.localeCompare(b.resource);
    }
    return a.action.localeCompare(b.action);
  });
}

export function renderBiscuitPermissionFacts(permissions: BiscuitPermission[]): string {
  return permissions.map((p) => `${p.action}("${escapeDatalogString(p.resource)}");`).join('\n');
}

export function renderBiscuitFactsForMethods(
  methods: string[],
  options: CollectBiscuitPermissionsOptions = {},
): string {
  return renderBiscuitPermissionFacts(collectBiscuitPermissions(methods, options));
}

export function listSupportedBiscuitMethods(): string[] {
  return Object.keys(RULES).sort();
}
