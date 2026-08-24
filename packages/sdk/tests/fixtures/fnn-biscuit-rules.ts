/**
 * Expected SDK Biscuit rule table, transcribed from fnn v0.9.0
 * `build_rules()` (crates/fiber-lib/src/rpc/biscuit.rs @ v0.9.0, also
 * documented in upstream docs/biscuit-auth.md).
 *
 * Deliberate omissions vs the upstream table:
 * - `subscribe_store_changes` — upstream requires `internal("store_changes")`,
 *   a node-internal scope that user-minted tokens must not carry.
 * - `backup_now` — upstream registers the rule under the key `backup_now`
 *   while the RPC method is named `backup`, so authenticated calls are
 *   fail-closed regardless of token contents ("no rules for method").
 *
 * `requiresChannelRight` is SDK-side modeling (upstream tracks a related but
 * different `require_rpc_context` flag for server-side node_id injection);
 * it is true only for the channel-scoped watchtower methods.
 *
 * When bumping the fnn target, re-transcribe this file from the new tag and
 * update `RULES` in `src/security/biscuit-policy.ts` to match.
 */
import type { BiscuitMethodRule } from '../../src/security/biscuit-policy.js';

function rule(
  action: 'read' | 'write',
  resource: string,
  requiresChannelRight = false,
): BiscuitMethodRule {
  return { permissions: [{ action, resource }], requiresChannelRight };
}

export const FNN_V0_9_0_RULES: Record<string, BiscuitMethodRule> = {
  // Cch
  send_btc: rule('write', 'cch'),
  receive_btc: rule('write', 'cch'),
  get_cch_order: rule('read', 'cch'),

  // Channel
  open_channel: rule('write', 'channels'),
  accept_channel: rule('write', 'channels'),
  abandon_channel: rule('write', 'channels'),
  list_channels: rule('read', 'channels'),
  shutdown_channel: rule('write', 'channels'),
  update_channel: rule('write', 'channels'),
  open_channel_with_external_funding: rule('write', 'channels'),
  submit_signed_funding_tx: rule('write', 'channels'),

  // Dev
  commitment_signed: rule('write', 'dev'),
  add_tlc: rule('write', 'dev'),
  remove_tlc: rule('write', 'dev'),
  check_channel_shutdown: rule('write', 'dev'),
  sign_external_funding_tx: rule('write', 'dev'),
  submit_commitment_transaction: rule('write', 'dev'),

  // Pprof
  pprof: rule('write', 'pprof'),

  // Graph
  graph_nodes: rule('read', 'graph'),
  graph_channels: rule('read', 'graph'),

  // Info
  node_info: rule('read', 'node'),

  // Invoice
  new_invoice: rule('write', 'invoices'),
  parse_invoice: rule('read', 'invoices'),
  get_invoice: rule('read', 'invoices'),
  cancel_invoice: rule('write', 'invoices'),
  settle_invoice: rule('write', 'invoices'),

  // Payment
  send_payment: rule('write', 'payments'),
  get_payment: rule('read', 'payments'),
  list_payments: rule('read', 'payments'),
  build_router: rule('read', 'payments'),
  send_payment_with_router: rule('write', 'payments'),

  // Peer
  connect_peer: rule('write', 'peers'),
  disconnect_peer: rule('write', 'peers'),
  list_peers: rule('read', 'peers'),

  // Watchtower
  create_watch_channel: rule('write', 'watchtower', true),
  remove_watch_channel: rule('write', 'watchtower', true),
  update_revocation: rule('write', 'watchtower', true),
  update_local_settlement: rule('write', 'watchtower', true),
  update_pending_remote_settlement: rule('write', 'watchtower', true),
  create_preimage: rule('write', 'watchtower'),
  remove_preimage: rule('write', 'watchtower'),
};
