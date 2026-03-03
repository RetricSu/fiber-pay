import {
  type Channel,
  ChannelState,
  type CkbInvoice,
  type GetPaymentResult,
  shannonsToCkb,
  toHex,
} from '@fiber-pay/sdk';

export function truncateMiddle(value: string, start = 10, end = 8): string {
  if (!value || value.length <= start + end + 3) {
    return value;
  }
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

export function parseHexTimestampMs(hexTimestamp: string): number | null {
  if (!hexTimestamp) return null;
  try {
    const raw = Number(BigInt(hexTimestamp));
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw > 1_000_000_000_000 ? raw : raw * 1000;
  } catch {
    return null;
  }
}

export function formatAge(whenMs: number | null): string {
  if (!whenMs) return 'unknown';
  const diff = Date.now() - whenMs;
  if (diff < 0) return 'just now';

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

export function stateLabel(state: ChannelState): string {
  switch (state) {
    case ChannelState.NegotiatingFunding:
      return '🔄 Negotiating Funding';
    case ChannelState.CollaboratingFundingTx:
      return '🧩 Collaborating Funding Tx';
    case ChannelState.SigningCommitment:
      return '✍️ Signing Commitment';
    case ChannelState.AwaitingTxSignatures:
      return '⏳ Awaiting Tx Signatures';
    case ChannelState.AwaitingChannelReady:
      return '⏳ Awaiting Channel Ready';
    case ChannelState.ChannelReady:
      return '✅ Channel Ready';
    case ChannelState.ShuttingDown:
      return '🛑 Shutting Down';
    case ChannelState.Closed:
      return '❌ Closed';
    default:
      return state;
  }
}

export function parseChannelState(input: string | undefined): ChannelState | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  const legacy = trimmed.toUpperCase();
  const normalizedInput = trimmed.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  const legacyMap: Record<string, ChannelState> = {
    NEGOTIATING_FUNDING: ChannelState.NegotiatingFunding,
    COLLABORATING_FUNDING_TX: ChannelState.CollaboratingFundingTx,
    SIGNING_COMMITMENT: ChannelState.SigningCommitment,
    AWAITING_TX_SIGNATURES: ChannelState.AwaitingTxSignatures,
    AWAITING_CHANNEL_READY: ChannelState.AwaitingChannelReady,
    CHANNEL_READY: ChannelState.ChannelReady,
    SHUTTING_DOWN: ChannelState.ShuttingDown,
    CLOSED: ChannelState.Closed,
  };

  if (legacy in legacyMap) return legacyMap[legacy];

  for (const value of Object.values(ChannelState)) {
    const normalizedValue = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (normalizedValue === normalizedInput) return value;
  }

  return undefined;
}

export function formatChannel(channel: Channel): Record<string, unknown> {
  const local = BigInt(channel.local_balance);
  const remote = BigInt(channel.remote_balance);
  const capacity = local + remote;
  const localPct = capacity > 0n ? Number((local * 100n) / capacity) : 0;
  const remotePct = capacity > 0n ? 100 - localPct : 0;

  return {
    channelId: channel.channel_id,
    channelIdShort: truncateMiddle(channel.channel_id, 10, 8),
    peerId: channel.peer_id,
    peerIdShort: truncateMiddle(channel.peer_id, 10, 8),
    state: channel.state.state_name,
    stateLabel: stateLabel(channel.state.state_name),
    stateFlags: channel.state.state_flags,
    localBalanceCkb: shannonsToCkb(channel.local_balance),
    remoteBalanceCkb: shannonsToCkb(channel.remote_balance),
    capacityCkb: shannonsToCkb(toHex(capacity)),
    balanceRatio: `${localPct}/${remotePct}`,
    pendingTlcs: channel.pending_tlcs.length,
    enabled: channel.enabled,
    isPublic: channel.is_public,
    age: formatAge(parseHexTimestampMs(channel.created_at)),
  };
}

export function getChannelSummary(channels: Channel[]): Record<string, unknown> {
  let totalLocal = 0n;
  let totalRemote = 0n;
  let active = 0;

  for (const channel of channels) {
    totalLocal += BigInt(channel.local_balance);
    totalRemote += BigInt(channel.remote_balance || '0x0');
    if (channel.state.state_name === ChannelState.ChannelReady) {
      active++;
    }
  }

  return {
    count: channels.length,
    activeCount: active,
    totalLocalCkb: shannonsToCkb(toHex(totalLocal)),
    totalRemoteCkb: shannonsToCkb(toHex(totalRemote)),
    totalCapacityCkb: shannonsToCkb(toHex(totalLocal + totalRemote)),
  };
}

export function extractInvoiceMetadata(invoice: CkbInvoice): {
  description?: string;
  expirySeconds?: number;
  expiresAt?: string;
  age: string;
} {
  let description: string | undefined;
  let expirySeconds: number | undefined;

  for (const attr of invoice.data.attrs) {
    if ('Description' in attr) description = attr.Description;
    if ('ExpiryTime' in attr) {
      try {
        expirySeconds = Number(BigInt(attr.ExpiryTime));
      } catch {
        // ignore malformed expiry field
      }
    }
  }

  const createdMs = parseHexTimestampMs(invoice.data.timestamp);
  const expiresAt =
    createdMs && expirySeconds
      ? new Date(createdMs + expirySeconds * 1000).toISOString()
      : undefined;

  return {
    description,
    expirySeconds,
    expiresAt,
    age: formatAge(createdMs),
  };
}

export function formatPaymentResult(payment: GetPaymentResult): Record<string, unknown> {
  const createdAtMs = parseHexTimestampMs(payment.created_at);
  const updatedAtMs = parseHexTimestampMs(payment.last_updated_at);

  return {
    paymentHash: payment.payment_hash,
    status: payment.status,
    feeCkb: shannonsToCkb(payment.fee),
    failureReason: payment.failed_error,
    createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : payment.created_at,
    updatedAt: updatedAtMs ? new Date(updatedAtMs).toISOString() : payment.last_updated_at,
    routeCount: payment.routers?.length ?? 0,
    routers: payment.routers,
  };
}

export function hasJsonFlag(args: string[]): boolean {
  return args.includes('--json');
}

export function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export interface CliErrorPayload {
  code: string;
  message: string;
  recoverable?: boolean;
  suggestion?: string;
  details?: unknown;
}

export function printJsonSuccess(data: unknown): void {
  printJson({ success: true, data });
}

export function printJsonError(error: CliErrorPayload): void {
  printJson({ success: false, error });
}

export function printJsonEvent(event: string, data: unknown, ts = new Date().toISOString()): void {
  process.stdout.write(`${JSON.stringify({ event, ts, data })}\n`);
}

export function printChannelDetailHuman(channel: Channel): void {
  const local = shannonsToCkb(channel.local_balance);
  const remote = shannonsToCkb(channel.remote_balance);
  const capacity = local + remote;

  console.log('Channel');
  console.log(`  ID:            ${channel.channel_id}`);
  console.log(`  Peer:          ${channel.peer_id}`);
  console.log(
    `  State:         ${stateLabel(channel.state.state_name)} (${channel.state.state_name})`,
  );
  console.log(`  Enabled:       ${channel.enabled ? 'yes' : 'no'}`);
  console.log(`  Public:        ${channel.is_public ? 'yes' : 'no'}`);
  console.log(
    `  Balance:       local ${local} CKB | remote ${remote} CKB | capacity ${capacity} CKB`,
  );
  console.log(`  Pending TLCs:  ${channel.pending_tlcs.length}`);
  console.log(`  Age:           ${formatAge(parseHexTimestampMs(channel.created_at))}`);
  console.log(
    `  Outpoint:      ${channel.channel_outpoint ? `${channel.channel_outpoint.tx_hash}:${channel.channel_outpoint.index}` : 'n/a'}`,
  );
  console.log(`  Commitment Tx: ${channel.latest_commitment_transaction_hash ?? 'n/a'}`);
  console.log(`  Shutdown Tx:   ${channel.shutdown_transaction_hash ?? 'n/a'}`);
}

export function printInvoiceDetailHuman(data: {
  paymentHash: string;
  status: string;
  invoice: string;
  amountCkb?: number;
  currency: string;
  description?: string;
  createdAt: string;
  expiresAt?: string;
  age: string;
}): void {
  console.log('Invoice');
  console.log(`  Payment Hash:  ${data.paymentHash}`);
  console.log(`  Status:        ${data.status}`);
  console.log(
    `  Amount:        ${data.amountCkb ?? 'n/a'} ${data.amountCkb !== undefined ? 'CKB' : ''}`.trim(),
  );
  console.log(`  Currency:      ${data.currency}`);
  console.log(`  Description:   ${data.description ?? 'n/a'}`);
  console.log(`  Created At:    ${data.createdAt}`);
  console.log(`  Expires At:    ${data.expiresAt ?? 'n/a'}`);
  console.log(`  Age:           ${data.age}`);
  console.log(`  Invoice:       ${data.invoice}`);
}

export function printPaymentDetailHuman(payment: GetPaymentResult): void {
  const createdAtMs = parseHexTimestampMs(payment.created_at);
  const updatedAtMs = parseHexTimestampMs(payment.last_updated_at);

  console.log('Payment');
  console.log(`  Hash:          ${payment.payment_hash}`);
  console.log(`  Status:        ${payment.status}`);
  console.log(`  Fee:           ${shannonsToCkb(payment.fee)} CKB`);
  console.log(`  Failure:       ${payment.failed_error ?? 'n/a'}`);
  console.log(
    `  Created At:    ${createdAtMs ? new Date(createdAtMs).toISOString() : payment.created_at}`,
  );
  console.log(
    `  Updated At:    ${updatedAtMs ? new Date(updatedAtMs).toISOString() : payment.last_updated_at}`,
  );
  const routers = payment.routers ?? [];
  console.log(`  Routes:        ${routers.length}`);
  if (routers.length > 0) {
    for (let i = 0; i < routers.length; i++) {
      const hops = routers[i].nodes.map((node) => truncateMiddle(node.pubkey, 8, 8)).join(' -> ');
      console.log(`    #${i + 1}: ${hops}`);
    }
  }
}

export function printChannelListHuman(channels: Channel[]): void {
  if (channels.length === 0) {
    console.log('No channels found.');
    return;
  }

  const summary = getChannelSummary(channels) as {
    count: number;
    activeCount: number;
    totalLocalCkb: number;
    totalRemoteCkb: number;
    totalCapacityCkb: number;
  };

  console.log(`Channels: ${summary.count} total, ${summary.activeCount} ready`);
  console.log(
    `Liquidity: local ${summary.totalLocalCkb} CKB | remote ${summary.totalRemoteCkb} CKB | capacity ${summary.totalCapacityCkb} CKB`,
  );
  console.log('');
  console.log(
    'ID                     PEER                   STATE                     LOCAL      REMOTE     TLC',
  );
  console.log(
    '---------------------------------------------------------------------------------------------------',
  );

  for (const channel of channels) {
    const id = truncateMiddle(channel.channel_id, 10, 8).padEnd(22, ' ');
    const peer = truncateMiddle(channel.peer_id, 10, 8).padEnd(22, ' ');
    const state = channel.state.state_name.padEnd(24, ' ');
    const local = `${shannonsToCkb(channel.local_balance)}`.padStart(8, ' ');
    const remote = `${shannonsToCkb(channel.remote_balance)}`.padStart(8, ' ');
    const tlcs = `${channel.pending_tlcs.length}`.padStart(4, ' ');
    console.log(`${id} ${peer} ${state} ${local} ${remote} ${tlcs}`);
  }
}

export function printBalanceHuman(data: {
  totalCkb: number;
  channelLocalCkb?: number;
  fundingAddress?: string;
  fundingAddressTotalCkb?: number;
  availableToSend: number;
  availableToReceive: number;
  channelCount: number;
  activeChannelCount: number;
  fundingBalanceError?: string;
}): void {
  console.log('Balance');
  console.log(`  Total:                ${data.totalCkb} CKB`);
  if (data.channelLocalCkb !== undefined) {
    console.log(`  In Channels (Local):  ${data.channelLocalCkb} CKB`);
  }
  console.log(`  Available To Send:    ${data.availableToSend} CKB`);
  console.log(`  Available To Receive: ${data.availableToReceive} CKB`);
  console.log(
    `  Channels:             ${data.channelCount} total (${data.activeChannelCount} active)`,
  );
  if (data.fundingAddressTotalCkb !== undefined) {
    console.log(`  Funding Address:      ${data.fundingAddressTotalCkb} CKB`);
  }
  if (data.fundingAddress) {
    console.log(`  Funding Lock Addr:    ${data.fundingAddress}`);
  }
  if (data.fundingBalanceError) {
    console.log(`  Funding Balance Note: ${data.fundingBalanceError}`);
  }
}

export function printPeerListHuman(
  peers: Array<{ peer_id: string; pubkey: string; address: string }>,
): void {
  if (peers.length === 0) {
    console.log('No connected peers.');
    return;
  }

  console.log(`Peers: ${peers.length}`);
  console.log('');
  console.log('PEER ID                 PUBKEY                  ADDRESS');
  console.log('--------------------------------------------------------------------------');
  for (const peer of peers) {
    const peerId = truncateMiddle(peer.peer_id, 10, 8).padEnd(22, ' ');
    const pubkey = truncateMiddle(peer.pubkey, 10, 8).padEnd(22, ' ');
    console.log(`${peerId} ${pubkey} ${peer.address}`);
  }
}
