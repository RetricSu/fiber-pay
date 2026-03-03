/**
 * Biscuit policy helpers for Fiber RPC.
 *
 * These helpers model the upstream RPC authorization rules and generate
 * token-side permission facts like `read("peers");` and `write("payments");`.
 */

export type BiscuitAction = 'read' | 'write';

export interface BiscuitPermission {
  action: BiscuitAction;
  resource: string;
}

export interface BiscuitMethodRule {
  method: string;
  permissions: BiscuitPermission[];
  requiresChannelRight: boolean;
}

const RULES: Record<string, BiscuitMethodRule> = {
  // Cch
  send_btc: {
    method: 'send_btc',
    permissions: [{ action: 'write', resource: 'cch' }],
    requiresChannelRight: false,
  },
  receive_btc: {
    method: 'receive_btc',
    permissions: [{ action: 'read', resource: 'cch' }],
    requiresChannelRight: false,
  },
  get_cch_order: {
    method: 'get_cch_order',
    permissions: [{ action: 'read', resource: 'cch' }],
    requiresChannelRight: false,
  },

  // Channel
  open_channel: {
    method: 'open_channel',
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  accept_channel: {
    method: 'accept_channel',
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  abandon_channel: {
    method: 'abandon_channel',
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  list_channels: {
    method: 'list_channels',
    permissions: [{ action: 'read', resource: 'channels' }],
    requiresChannelRight: false,
  },
  shutdown_channel: {
    method: 'shutdown_channel',
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  update_channel: {
    method: 'update_channel',
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },

  // Dev
  commitment_signed: {
    method: 'commitment_signed',
    permissions: [{ action: 'write', resource: 'messages' }],
    requiresChannelRight: false,
  },
  add_tlc: {
    method: 'add_tlc',
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  remove_tlc: {
    method: 'remove_tlc',
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  check_channel_shutdown: {
    method: 'check_channel_shutdown',
    permissions: [{ action: 'write', resource: 'channels' }],
    requiresChannelRight: false,
  },
  submit_commitment_transaction: {
    method: 'submit_commitment_transaction',
    permissions: [{ action: 'write', resource: 'chain' }],
    requiresChannelRight: false,
  },

  // Graph
  graph_nodes: {
    method: 'graph_nodes',
    permissions: [{ action: 'read', resource: 'graph' }],
    requiresChannelRight: false,
  },
  graph_channels: {
    method: 'graph_channels',
    permissions: [{ action: 'read', resource: 'graph' }],
    requiresChannelRight: false,
  },

  // Info
  node_info: {
    method: 'node_info',
    permissions: [{ action: 'read', resource: 'node' }],
    requiresChannelRight: false,
  },

  // Invoice
  new_invoice: {
    method: 'new_invoice',
    permissions: [{ action: 'write', resource: 'invoices' }],
    requiresChannelRight: false,
  },
  parse_invoice: {
    method: 'parse_invoice',
    permissions: [{ action: 'read', resource: 'invoices' }],
    requiresChannelRight: false,
  },
  get_invoice: {
    method: 'get_invoice',
    permissions: [{ action: 'read', resource: 'invoices' }],
    requiresChannelRight: false,
  },
  cancel_invoice: {
    method: 'cancel_invoice',
    permissions: [{ action: 'write', resource: 'invoices' }],
    requiresChannelRight: false,
  },
  settle_invoice: {
    method: 'settle_invoice',
    permissions: [{ action: 'write', resource: 'invoices' }],
    requiresChannelRight: false,
  },

  // Payment
  send_payment: {
    method: 'send_payment',
    permissions: [{ action: 'write', resource: 'payments' }],
    requiresChannelRight: false,
  },
  get_payment: {
    method: 'get_payment',
    permissions: [{ action: 'read', resource: 'payments' }],
    requiresChannelRight: false,
  },
  build_router: {
    method: 'build_router',
    permissions: [{ action: 'read', resource: 'payments' }],
    requiresChannelRight: false,
  },
  send_payment_with_router: {
    method: 'send_payment_with_router',
    permissions: [{ action: 'write', resource: 'payments' }],
    requiresChannelRight: false,
  },

  // Peer
  connect_peer: {
    method: 'connect_peer',
    permissions: [{ action: 'write', resource: 'peers' }],
    requiresChannelRight: false,
  },
  disconnect_peer: {
    method: 'disconnect_peer',
    permissions: [{ action: 'write', resource: 'peers' }],
    requiresChannelRight: false,
  },
  list_peers: {
    method: 'list_peers',
    permissions: [{ action: 'read', resource: 'peers' }],
    requiresChannelRight: false,
  },

  // Watchtower
  create_watch_channel: {
    method: 'create_watch_channel',
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: true,
  },
  remove_watch_channel: {
    method: 'remove_watch_channel',
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: true,
  },
  update_revocation: {
    method: 'update_revocation',
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: true,
  },
  update_local_settlement: {
    method: 'update_local_settlement',
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: true,
  },
  update_pending_remote_settlement: {
    method: 'update_pending_remote_settlement',
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: true,
  },
  create_preimage: {
    method: 'create_preimage',
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: false,
  },
  remove_preimage: {
    method: 'remove_preimage',
    permissions: [{ action: 'write', resource: 'watchtower' }],
    requiresChannelRight: false,
  },
};

export function getBiscuitRuleForMethod(method: string): BiscuitMethodRule | undefined {
  return RULES[method];
}

export function collectBiscuitPermissions(methods: string[]): BiscuitPermission[] {
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

  return [...dedup.values()].sort((a, b) => {
    if (a.action === b.action) {
      return a.resource.localeCompare(b.resource);
    }
    return a.action.localeCompare(b.action);
  });
}

export function renderBiscuitPermissionFacts(permissions: BiscuitPermission[]): string {
  return permissions.map((p) => `${p.action}("${p.resource}");`).join('\n');
}

export function renderBiscuitFactsForMethods(methods: string[]): string {
  return renderBiscuitPermissionFacts(collectBiscuitPermissions(methods));
}

export function listSupportedBiscuitMethods(): string[] {
  return Object.keys(RULES).sort();
}
