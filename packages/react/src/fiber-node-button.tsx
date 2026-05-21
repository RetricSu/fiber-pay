import type {
  AbandonChannelParams,
  CellDep,
  Channel,
  FiberBrowserNode,
  FiberWasmFactory,
  GraphChannelsResult,
  GraphNodesResult,
  HexString,
  ListPeersResult,
  NodeInfoResult,
  Script,
  ShutdownChannelParams,
} from '@fiber-pay/sdk/browser';
import { ChannelState, shannonsToCkb } from '@fiber-pay/sdk/browser';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  ConnectButton,
  type ConnectButtonConnectedDropdownContext,
  type ConnectStrategy,
} from './connect-button.js';
import { useChannelOpenFlow } from './use-channel-open-flow.js';
import type { UseFiberNodeOptions, UseFiberNodeResult } from './use-fiber-node.js';
import { useFiberNode } from './use-fiber-node.js';
import { useFiberPayment } from './use-fiber-payment.js';

const ONE_CKB_SHANNONS = '0x5f5e100';

type ChannelFilter = 'active' | 'pending' | 'closed' | 'all';
type GraphChannelInfo = GraphChannelsResult['channels'][number];
type GraphNodeInfo = GraphNodesResult['nodes'][number];
type PeerInfo = ListPeersResult['peers'][number];

function shorten(value: string, head = 10, tail = 8): string {
  if (!value || value.length <= head + tail + 3) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function toHexPrefixed(value: string): HexString {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Hex value is empty.');
  }
  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as HexString;
}

function isPendingChannelState(state: ChannelState): boolean {
  return (
    state === ChannelState.NegotiatingFunding ||
    state === ChannelState.CollaboratingFundingTx ||
    state === ChannelState.SigningCommitment ||
    state === ChannelState.AwaitingTxSignatures ||
    state === ChannelState.AwaitingChannelReady
  );
}

function formatChannelBalance(shannonsHex: HexString): string {
  const ckb = shannonsToCkb(shannonsHex);
  return Number.isFinite(ckb) ? ckb.toFixed(4) : '0.0000';
}

function isClosedChannelState(state: ChannelState): boolean {
  return state === ChannelState.Closed || state === ChannelState.ShuttingDown;
}

function getChannelFilterState(channel: Channel): ChannelFilter {
  const state = channel.state.state_name;
  if (isPendingChannelState(state)) return 'pending';
  if (isClosedChannelState(state)) return 'closed';
  return 'active';
}

export interface FiberNodeButtonExternalFundingResolved {
  signFundingTx: (txForSigner: unknown) => Promise<unknown>;
  shutdownScript?: Script;
  fundingLockScript?: Script;
  fundingLockScriptCellDeps?: CellDep[];
  ckbRpcUrl?: string;
}

export interface FiberNodeButtonExternalFundingResolverContext {
  node: FiberBrowserNode;
  pubkey: HexString;
  fundingAmountCkb: string;
}

export interface FiberNodeButtonExternalFundingConfig {
  enabled: boolean;
  resolve: (
    context: FiberNodeButtonExternalFundingResolverContext,
  ) => Promise<FiberNodeButtonExternalFundingResolved>;
}

export interface FiberNodeButtonConnectorSectionContext {
  fiber: UseFiberNodeResult;
  externalFundingEnabled: boolean;
  isOpeningChannel: boolean;
}

export interface FiberNodeButtonProps {
  network?: 'testnet' | 'mainnet';
  fiber?: UseFiberNodeResult;
  strategy?: ConnectStrategy;
  externalWallet?: boolean;
  password?: string;
  walletId?: string;
  passkeyUsername?: string;
  wasmFactory?: FiberWasmFactory;
  nodeConfig?: UseFiberNodeOptions['nodeConfig'];
  className?: string;
  style?: CSSProperties;
  dropdownStyle?: CSSProperties;
  onConnect?: (node: FiberBrowserNode, nodeInfo: NodeInfoResult) => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
  onLog?: (message: string) => void;
  initialPeerPubkey?: string;
  initialPeerAddress?: string;
  initialFundingAmountCkb?: string;
  externalFunding?: FiberNodeButtonExternalFundingConfig;
  renderConnectorSection?: (context: FiberNodeButtonConnectorSectionContext) => ReactNode;
}

const styles = {
  panel: {
    display: 'grid',
    gap: '0.75rem',
    minWidth: '360px',
  } satisfies CSSProperties,

  section: {
    border: '1px solid var(--fpay-border, #e5e7eb)',
    borderRadius: '0.6rem',
    padding: '0.6rem',
    background: 'var(--fpay-bg-secondary, #f8fafc)',
  } satisfies CSSProperties,

  sectionTitle: {
    margin: '0 0 0.5rem',
    fontSize: '0.78rem',
    fontWeight: 700,
    color: 'var(--fpay-text-primary, #111827)',
    letterSpacing: '0.02em',
  } satisfies CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.5rem',
  } satisfies CSSProperties,

  rowBetween: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    marginBottom: '0.5rem',
  } satisfies CSSProperties,

  stack: {
    display: 'grid',
    gap: '0.5rem',
  } satisfies CSSProperties,

  fieldLabel: {
    display: 'grid',
    gap: '0.25rem',
    fontSize: '0.68rem',
    fontWeight: 700,
    color: 'var(--fpay-text-secondary, #64748b)',
    textTransform: 'uppercase',
  } satisfies CSSProperties,

  compactText: {
    fontSize: '0.75rem',
    color: 'var(--fpay-text-secondary, #6b7280)',
    margin: 0,
  } satisfies CSSProperties,

  input: {
    width: '100%',
    border: '1px solid var(--fpay-border, #cbd5e1)',
    borderRadius: '0.4rem',
    padding: '0.35rem 0.45rem',
    fontSize: '0.78rem',
    background: '#fff',
  } satisfies CSSProperties,

  actionButton: {
    border: '1px solid var(--fpay-border, #cbd5e1)',
    borderRadius: '0.45rem',
    padding: '0.35rem 0.55rem',
    fontSize: '0.76rem',
    fontWeight: 600,
    background: '#fff',
    color: 'var(--fpay-text-primary, #111827)',
    cursor: 'pointer',
  } satisfies CSSProperties,

  ghostButton: {
    border: '1px solid transparent',
    borderRadius: '0.45rem',
    padding: '0.32rem 0.5rem',
    fontSize: '0.74rem',
    fontWeight: 600,
    background: 'transparent',
    color: 'var(--fpay-text-secondary, #475569)',
    cursor: 'pointer',
  } satisfies CSSProperties,

  dangerButton: {
    border: '1px solid #fecaca',
    borderRadius: '0.45rem',
    padding: '0.35rem 0.55rem',
    fontSize: '0.76rem',
    fontWeight: 700,
    background: '#fff1f2',
    color: '#9f1239',
    cursor: 'pointer',
  } satisfies CSSProperties,

  primaryButton: {
    border: '1px solid var(--fpay-accent, #2563eb)',
    borderRadius: '0.45rem',
    padding: '0.35rem 0.55rem',
    fontSize: '0.76rem',
    fontWeight: 700,
    background: 'var(--fpay-accent, #2563eb)',
    color: '#fff',
    cursor: 'pointer',
  } satisfies CSSProperties,

  errorBox: {
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#9f1239',
    borderRadius: '0.5rem',
    padding: '0.45rem 0.55rem',
    fontSize: '0.74rem',
    marginTop: '0.2rem',
  } satisfies CSSProperties,

  channelList: {
    marginTop: '0.55rem',
    display: 'grid',
    gap: '0.45rem',
    maxHeight: '220px',
    overflowY: 'auto',
    paddingRight: '0.15rem',
  } satisfies CSSProperties,

  channelItem: {
    border: '1px solid var(--fpay-border, #dbe1ea)',
    borderRadius: '0.45rem',
    background: '#fff',
    padding: '0.55rem',
    display: 'grid',
    gap: '0.45rem',
  } satisfies CSSProperties,

  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '0.4rem',
  } satisfies CSSProperties,

  statTile: {
    border: '1px solid var(--fpay-border, #dbe1ea)',
    borderRadius: '0.45rem',
    background: '#fff',
    padding: '0.45rem',
  } satisfies CSSProperties,

  statValue: {
    display: 'block',
    fontSize: '0.95rem',
    fontWeight: 750,
    color: 'var(--fpay-text-primary, #0f172a)',
    lineHeight: 1.1,
  } satisfies CSSProperties,

  statLabel: {
    display: 'block',
    marginTop: '0.12rem',
    fontSize: '0.65rem',
    color: 'var(--fpay-text-secondary, #64748b)',
  } satisfies CSSProperties,

  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    width: 'fit-content',
    borderRadius: '999px',
    border: '1px solid var(--fpay-border, #cbd5e1)',
    background: '#f8fafc',
    color: 'var(--fpay-text-secondary, #475569)',
    padding: '0.12rem 0.42rem',
    fontSize: '0.66rem',
    fontWeight: 700,
  } satisfies CSSProperties,

  filterBar: {
    display: 'flex',
    gap: '0.25rem',
    flexWrap: 'wrap',
  } satisfies CSSProperties,

  inlineCode: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.72rem',
    color: 'var(--fpay-text-primary, #111827)',
    margin: 0,
  } satisfies CSSProperties,
};

export function FiberNodeButton(props: FiberNodeButtonProps) {
  const {
    network = 'testnet',
    fiber: externalFiber,
    strategy = 'passkey',
    externalWallet = false,
    password,
    walletId,
    passkeyUsername = 'User',
    wasmFactory,
    nodeConfig,
    className,
    style,
    dropdownStyle,
    onConnect,
    onDisconnect,
    onError,
    onLog,
    initialPeerPubkey = '',
    initialPeerAddress = '',
    initialFundingAmountCkb = '1000',
    externalFunding,
    renderConnectorSection,
  } = props;

  const managedFiber = useFiberNode({
    network,
    walletId,
    wasmFactory,
    nodeConfig,
    externalWallet,
    enabled: !externalFiber,
  });
  const fiber = externalFiber ?? managedFiber;

  const [peerPubkey, setPeerPubkey] = useState(initialPeerPubkey);
  const [peerAddress, setPeerAddress] = useState(initialPeerAddress);
  const [fundingAmountCkb, setFundingAmountCkb] = useState(initialFundingAmountCkb);
  const [connectedPeers, setConnectedPeers] = useState<PeerInfo[]>([]);
  const [isRefreshingPeers, setIsRefreshingPeers] = useState(false);
  const [isConnectingPeer, setIsConnectingPeer] = useState(false);
  const [graphNodes, setGraphNodes] = useState<GraphNodeInfo[]>([]);
  const [graphChannels, setGraphChannels] = useState<GraphChannelInfo[]>([]);
  const [isRefreshingGraph, setIsRefreshingGraph] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('active');
  const [isRefreshingChannels, setIsRefreshingChannels] = useState(false);
  const [closingChannelId, setClosingChannelId] = useState<string | null>(null);

  const [invoiceInput, setInvoiceInput] = useState('');
  const [createdInvoice, setCreatedInvoice] = useState('');
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const peerListId = useId();

  const channelOpenFlow = useChannelOpenFlow({
    node: fiber.node,
    onLog,
  });

  const { payInvoice, isPaying, paymentResult, error: paymentError } = useFiberPayment(fiber.node);

  const reportError = useCallback(
    (message: string) => {
      setLocalError(message);
      onError?.(message);
    },
    [onError],
  );

  const refreshConnectedPeers = useCallback(async () => {
    if (!fiber.node) {
      setConnectedPeers([]);
      return;
    }

    setIsRefreshingPeers(true);
    setLocalError(null);

    try {
      const peers = await fiber.node.listPeers();
      setConnectedPeers(peers.peers);
      setPeerPubkey((prev) => (prev.trim() ? prev : (peers.peers[0]?.pubkey ?? prev)));
      onLog?.(`Loaded connected peers: ${peers.peers.length}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
      onLog?.(`Refresh peers failed: ${message}`);
    } finally {
      setIsRefreshingPeers(false);
    }
  }, [fiber.node, onLog, reportError]);

  const refreshGraph = useCallback(async () => {
    if (!fiber.node) {
      setGraphNodes([]);
      setGraphChannels([]);
      return;
    }

    setIsRefreshingGraph(true);
    setLocalError(null);

    try {
      const [nodesResult, channelsResult] = await Promise.all([
        fiber.node.graphNodes({ limit: '0x8' }),
        fiber.node.graphChannels({ limit: '0x8' }),
      ]);
      setGraphNodes(nodesResult.nodes);
      setGraphChannels(channelsResult.channels);
      onLog?.(
        `Loaded graph: ${nodesResult.nodes.length} nodes, ${channelsResult.channels.length} channels.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
      onLog?.(`Refresh graph failed: ${message}`);
    } finally {
      setIsRefreshingGraph(false);
    }
  }, [fiber.node, onLog, reportError]);

  const connectPeerByAddress = useCallback(async () => {
    if (!fiber.node) {
      reportError('Node is not connected.');
      return;
    }

    if (!peerAddress.trim()) {
      reportError('Peer address is empty.');
      return;
    }

    setIsConnectingPeer(true);
    setLocalError(null);

    try {
      await fiber.node.connectPeer({
        address: peerAddress.trim(),
        save: true,
      });
      onLog?.('Peer connected from address input.');
      await refreshConnectedPeers();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
      onLog?.(`Connect peer failed: ${message}`);
    } finally {
      setIsConnectingPeer(false);
    }
  }, [fiber.node, onLog, peerAddress, refreshConnectedPeers, reportError]);

  const refreshChannels = useCallback(async () => {
    if (!fiber.node) {
      setChannels([]);
      return;
    }

    setIsRefreshingChannels(true);
    setLocalError(null);

    try {
      const result = await fiber.node.listChannels({ include_closed: true });
      setChannels(result.channels);
      onLog?.(`Loaded channels: ${result.channels.length}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
      onLog?.(`Refresh channels failed: ${message}`);
    } finally {
      setIsRefreshingChannels(false);
    }
  }, [fiber.node, onLog, reportError]);

  const closeChannel = useCallback(
    async (channelId: string, force = false) => {
      if (!fiber.node) {
        reportError('Node is not connected.');
        return;
      }

      setClosingChannelId(channelId);
      setLocalError(null);

      try {
        const latest = await fiber.node.listChannels({ include_closed: true });
        const target = latest.channels.find((item) => item.channel_id === channelId);

        if (!target) {
          throw new Error(`Channel not found in latest snapshot: ${channelId}.`);
        }

        if (target.state.state_name === ChannelState.Closed) {
          setChannels(latest.channels);
          onLog?.(`Channel already closed: ${channelId}`);
          return;
        }

        if (target.state.state_name === ChannelState.ShuttingDown) {
          setChannels(latest.channels);
          onLog?.(`Channel is already shutting down: ${channelId}`);
          return;
        }

        if (isPendingChannelState(target.state.state_name)) {
          const params: AbandonChannelParams = {
            channel_id: channelId as HexString,
          };
          await fiber.node.abandonChannel(params);
          onLog?.(`Pending channel abandoned: ${channelId}`);
        } else {
          const params: ShutdownChannelParams = {
            channel_id: channelId as HexString,
            force,
          };
          await fiber.node.shutdownChannel(params);
          onLog?.(`${force ? 'Force close' : 'Close'} channel requested: ${channelId}`);
        }

        await refreshChannels();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reportError(message);
      } finally {
        setClosingChannelId(null);
      }
    },
    [fiber.node, onLog, refreshChannels, reportError],
  );

  const openChannel = useCallback(async () => {
    if (!fiber.node) {
      reportError('Node is not connected.');
      return;
    }

    if (!peerPubkey.trim()) {
      reportError('Target peer pubkey is empty.');
      return;
    }

    setLocalError(null);
    channelOpenFlow.reset();

    try {
      const pubkey = toHexPrefixed(peerPubkey);

      if (!externalFunding?.enabled) {
        await channelOpenFlow.openChannel({
          pubkey,
          fundingAmountCkb,
          externalWallet: false,
        });
        await refreshChannels();
        return;
      }

      const resolved = await externalFunding.resolve({
        node: fiber.node,
        pubkey,
        fundingAmountCkb,
      });

      await channelOpenFlow.openChannel({
        pubkey,
        fundingAmountCkb,
        externalWallet: true,
        shutdownScript: resolved.shutdownScript,
        fundingLockScript: resolved.fundingLockScript,
        fundingLockScriptCellDeps: resolved.fundingLockScriptCellDeps,
        signFundingTx: resolved.signFundingTx,
        ckbRpcUrl: resolved.ckbRpcUrl,
      });
      await refreshChannels();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
      onLog?.(`Open channel failed: ${message}`);
    }
  }, [
    channelOpenFlow,
    externalFunding,
    fiber.node,
    fundingAmountCkb,
    onLog,
    peerPubkey,
    refreshChannels,
    reportError,
  ]);

  const createInvoice = useCallback(async () => {
    if (!fiber.node) {
      reportError('Node is not connected.');
      return;
    }

    setIsCreatingInvoice(true);
    setLocalError(null);

    try {
      const created = await fiber.node.newInvoice({
        amount: ONE_CKB_SHANNONS,
        currency: network === 'mainnet' ? 'Fibb' : 'Fibt',
        description: 'FiberNodeButton invoice',
      });
      setCreatedInvoice(created.invoice_address);
      onLog?.(`Invoice created: ${shorten(created.invoice_address, 20, 8)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
    } finally {
      setIsCreatingInvoice(false);
    }
  }, [fiber.node, network, onLog, reportError]);

  const submitPayment = useCallback(async () => {
    if (!invoiceInput.trim()) {
      reportError('Invoice is empty.');
      return;
    }

    setLocalError(null);
    await payInvoice(invoiceInput);
  }, [invoiceInput, payInvoice, reportError]);

  useEffect(() => {
    if (paymentError) {
      reportError(paymentError);
    }
  }, [paymentError, reportError]);

  useEffect(() => {
    if (paymentResult) {
      onLog?.(`Payment status: ${paymentResult.status}`);
    }
  }, [onLog, paymentResult]);

  useEffect(() => {
    if (!fiber.isRunning || !fiber.node) {
      setConnectedPeers([]);
      setGraphNodes([]);
      setGraphChannels([]);
      setChannels([]);
      return;
    }

    void refreshConnectedPeers();
    void refreshGraph();
    void refreshChannels();
  }, [fiber.isRunning, fiber.node, refreshChannels, refreshConnectedPeers, refreshGraph]);

  const channelCounts = useMemo(() => {
    const counts = { active: 0, pending: 0, closed: 0, all: channels.length };

    for (const channel of channels) {
      counts[getChannelFilterState(channel)] += 1;
    }

    return counts;
  }, [channels]);

  const visibleChannels = useMemo(
    () =>
      channelFilter === 'all'
        ? channels
        : channels.filter((channel) => getChannelFilterState(channel) === channelFilter),
    [channelFilter, channels],
  );

  const mergedError = useMemo(
    () => localError ?? channelOpenFlow.error ?? paymentError,
    [channelOpenFlow.error, localError, paymentError],
  );

  const handleConnectButtonError = useCallback(
    (error: string) => {
      reportError(error);
    },
    [reportError],
  );

  const connectorContext: FiberNodeButtonConnectorSectionContext = useMemo(
    () => ({
      fiber,
      externalFundingEnabled: !!externalFunding?.enabled,
      isOpeningChannel: channelOpenFlow.isOpening,
    }),
    [channelOpenFlow.isOpening, externalFunding?.enabled, fiber],
  );

  const renderDropdown = useCallback(
    (dropdownContext: ConnectButtonConnectedDropdownContext) => (
      <div style={styles.panel}>
        <section style={styles.section}>
          <h4 style={styles.sectionTitle}>Connection</h4>
          <div style={styles.statGrid}>
            <div style={styles.statTile}>
              <span style={styles.statValue}>{fiber.state}</span>
              <span style={styles.statLabel}>State</span>
            </div>
            <div style={styles.statTile}>
              <span style={styles.statValue}>
                {externalFunding?.enabled ? 'External' : 'Internal'}
              </span>
              <span style={styles.statLabel}>Funding</span>
            </div>
            <div style={styles.statTile}>
              <span style={styles.statValue}>{connectedPeers.length}</span>
              <span style={styles.statLabel}>Peers</span>
            </div>
          </div>
          <p style={{ ...styles.inlineCode, marginTop: '0.5rem' }}>
            Node: {fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey, 18, 12) : 'N/A'}
          </p>
          <div style={{ ...styles.row, marginBottom: 0 }}>
            <button
              type="button"
              style={styles.actionButton}
              onClick={() => {
                void dropdownContext.disconnect();
              }}
            >
              Disconnect
            </button>
            <button
              type="button"
              style={styles.actionButton}
              onClick={() => {
                dropdownContext.closeDropdown();
              }}
            >
              Close
            </button>
          </div>
          {renderConnectorSection ? (
            <div
              style={{ marginTop: '0.6rem', paddingTop: '0.55rem', borderTop: '1px solid #e2e8f0' }}
            >
              {renderConnectorSection(connectorContext)}
            </div>
          ) : null}
        </section>

        <section style={styles.section}>
          <div style={styles.rowBetween}>
            <h4 style={{ ...styles.sectionTitle, margin: 0 }}>Peers & Graph</h4>
            <div style={styles.filterBar}>
              <button
                type="button"
                style={styles.actionButton}
                disabled={isRefreshingPeers}
                onClick={() => {
                  void refreshConnectedPeers();
                }}
              >
                {isRefreshingPeers ? 'Refreshing...' : 'Refresh Peers'}
              </button>
              <button
                type="button"
                style={styles.actionButton}
                disabled={isRefreshingGraph}
                onClick={() => {
                  void refreshGraph();
                }}
              >
                {isRefreshingGraph ? 'Loading...' : 'Refresh Graph'}
              </button>
            </div>
          </div>

          <div style={styles.statGrid}>
            <div style={styles.statTile}>
              <span style={styles.statValue}>{connectedPeers.length}</span>
              <span style={styles.statLabel}>Connected</span>
            </div>
            <div style={styles.statTile}>
              <span style={styles.statValue}>{graphNodes.length}</span>
              <span style={styles.statLabel}>Graph Nodes</span>
            </div>
            <div style={styles.statTile}>
              <span style={styles.statValue}>{graphChannels.length}</span>
              <span style={styles.statLabel}>Graph Channels</span>
            </div>
          </div>

          <div style={{ ...styles.stack, marginTop: '0.55rem' }}>
            <label style={styles.fieldLabel}>
              Connect peer
              <input
                style={styles.input}
                value={peerAddress}
                onChange={(event) => setPeerAddress(event.target.value)}
                placeholder="Peer address (/dns4/.../wss/p2p/...)"
              />
            </label>
            <button
              type="button"
              style={styles.primaryButton}
              disabled={isConnectingPeer || !peerAddress.trim()}
              onClick={() => {
                void connectPeerByAddress();
              }}
            >
              {isConnectingPeer ? 'Connecting...' : 'Connect Peer'}
            </button>
          </div>

          <div style={styles.channelList}>
            {connectedPeers.length === 0 ? (
              <p style={styles.compactText}>No connected peers.</p>
            ) : (
              connectedPeers.map((peer) => (
                <article key={peer.pubkey} style={styles.channelItem}>
                  <p style={styles.inlineCode}>Peer: {shorten(peer.pubkey, 18, 12)}</p>
                  <p style={styles.compactText}>{peer.address}</p>
                  <button
                    type="button"
                    style={styles.ghostButton}
                    onClick={() => setPeerPubkey(peer.pubkey)}
                  >
                    Use for Channel
                  </button>
                </article>
              ))
            )}
          </div>

          {graphNodes.length > 0 || graphChannels.length > 0 ? (
            <div style={{ ...styles.stack, marginTop: '0.55rem' }}>
              <p style={styles.compactText}>
                Graph sample (showing {Math.min(graphNodes.length, 3)} of {graphNodes.length} nodes,{' '}
                {Math.min(graphChannels.length, 2)} of {graphChannels.length} channels)
              </p>
              {graphNodes.slice(0, 3).map((node) => (
                <p key={node.pubkey} style={styles.inlineCode}>
                  Node: {node.node_name || shorten(node.pubkey, 18, 10)}
                </p>
              ))}
              {graphChannels.slice(0, 2).map((channel) => (
                <p
                  key={`${channel.node1}-${channel.node2}-${channel.channel_outpoint.tx_hash}`}
                  style={styles.inlineCode}
                >
                  Route: {shorten(channel.node1, 10, 6)} {'to'} {shorten(channel.node2, 10, 6)};{' '}
                  {formatChannelBalance(channel.capacity)} CKB
                </p>
              ))}
            </div>
          ) : null}
        </section>

        <section style={styles.section}>
          <div style={styles.rowBetween}>
            <h4 style={{ ...styles.sectionTitle, margin: 0 }}>Channels</h4>
            <button
              type="button"
              style={styles.actionButton}
              disabled={isRefreshingChannels}
              onClick={() => {
                void refreshChannels();
              }}
            >
              {isRefreshingChannels ? 'Refreshing...' : 'Refresh Channels'}
            </button>
          </div>

          <div style={styles.statGrid}>
            <div style={styles.statTile}>
              <span style={styles.statValue}>{channelCounts.active}</span>
              <span style={styles.statLabel}>Active</span>
            </div>
            <div style={styles.statTile}>
              <span style={styles.statValue}>{channelCounts.pending}</span>
              <span style={styles.statLabel}>Pending</span>
            </div>
            <div style={styles.statTile}>
              <span style={styles.statValue}>{channelCounts.closed}</span>
              <span style={styles.statLabel}>Closed</span>
            </div>
          </div>

          <div style={{ ...styles.filterBar, marginTop: '0.65rem' }}>
            {(['active', 'pending', 'closed', 'all'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                style={channelFilter === filter ? styles.primaryButton : styles.actionButton}
                onClick={() => setChannelFilter(filter)}
              >
                {filter === 'all'
                  ? `All (${channelCounts.all})`
                  : `${filter} (${channelCounts[filter]})`}
              </button>
            ))}
          </div>

          <div style={styles.channelList}>
            {visibleChannels.length === 0 ? (
              <p style={styles.compactText}>No channels found.</p>
            ) : (
              visibleChannels.map((channel) => {
                const stateName = channel.state.state_name;
                const pending = isPendingChannelState(stateName);
                const canClose =
                  stateName !== ChannelState.Closed && stateName !== ChannelState.ShuttingDown;
                const isClosing = closingChannelId === channel.channel_id;

                return (
                  <article key={channel.channel_id} style={styles.channelItem}>
                    <div style={styles.rowBetween}>
                      <p style={styles.inlineCode}>ID: {shorten(channel.channel_id, 16, 10)}</p>
                      <span style={styles.badge}>{stateName}</span>
                    </div>
                    <p style={styles.inlineCode}>Peer: {shorten(channel.pubkey, 18, 10)}</p>
                    <div style={styles.statGrid}>
                      <div style={styles.statTile}>
                        <span style={styles.statValue}>
                          {formatChannelBalance(channel.local_balance)}
                        </span>
                        <span style={styles.statLabel}>Local CKB</span>
                      </div>
                      <div style={styles.statTile}>
                        <span style={styles.statValue}>
                          {formatChannelBalance(channel.remote_balance)}
                        </span>
                        <span style={styles.statLabel}>Remote CKB</span>
                      </div>
                      <div
                        style={styles.statTile}
                        title="Pending TLCs (in-flight HTLC-like payment locks on this channel)"
                      >
                        <span style={styles.statValue}>{channel.pending_tlcs.length}</span>
                        <span style={styles.statLabel}>TLCs</span>
                      </div>
                    </div>
                    {channel.shutdown_transaction_hash ? (
                      <p style={styles.inlineCode}>
                        Shutdown: {shorten(channel.shutdown_transaction_hash, 16, 10)}
                      </p>
                    ) : null}
                    {channel.failure_detail ? (
                      <p style={styles.compactText}>{channel.failure_detail}</p>
                    ) : null}
                    <div style={{ ...styles.row, marginBottom: 0, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        style={styles.actionButton}
                        disabled={!canClose || isClosing}
                        onClick={() => {
                          void closeChannel(channel.channel_id, false);
                        }}
                      >
                        {isClosing ? 'Closing...' : pending ? 'Abandon Pending' : 'Close Channel'}
                      </button>
                      <button
                        type="button"
                        style={styles.dangerButton}
                        disabled={pending || !canClose || isClosing}
                        onClick={() => {
                          void closeChannel(channel.channel_id, true);
                        }}
                      >
                        Force Close
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <div
            style={{
              marginTop: '0.75rem',
              paddingTop: '0.6rem',
              borderTop: '1px solid #e2e8f0',
            }}
          >
            <h5
              style={{
                ...styles.sectionTitle,
                margin: '0 0 0.5rem',
                fontSize: '0.72rem',
              }}
            >
              Open new channel
            </h5>
            <div style={styles.stack}>
              <label style={styles.fieldLabel}>
                Target peer pubkey
                <input
                  style={styles.input}
                  list={peerListId}
                  value={peerPubkey}
                  onChange={(event) => setPeerPubkey(event.target.value)}
                  placeholder={connectedPeers[0]?.pubkey ?? '0x...'}
                />
                <datalist id={peerListId}>
                  {connectedPeers.map((peer) => (
                    <option key={peer.pubkey} value={peer.pubkey} />
                  ))}
                </datalist>
              </label>
              <label style={styles.fieldLabel}>
                Funding amount (CKB)
                <input
                  style={styles.input}
                  value={fundingAmountCkb}
                  onChange={(event) => setFundingAmountCkb(event.target.value)}
                  placeholder="1000"
                />
              </label>
            </div>
            <div style={{ ...styles.row, marginTop: '0.55rem', marginBottom: 0 }}>
              <button
                type="button"
                style={styles.primaryButton}
                disabled={channelOpenFlow.isOpening || !peerPubkey.trim()}
                onClick={() => {
                  void openChannel();
                }}
              >
                {channelOpenFlow.isOpening ? 'Opening...' : 'Open Channel'}
              </button>
            </div>
            {channelOpenFlow.lastResult && (
              <p style={{ ...styles.compactText, marginTop: '0.45rem' }}>
                Channel: {shorten(channelOpenFlow.lastResult.channelId, 12, 8)}
              </p>
            )}
            {channelOpenFlow.suggestedFundingAmountCkb && (
              <p style={{ ...styles.compactText, marginTop: '0.35rem' }}>
                Suggested amount: {channelOpenFlow.suggestedFundingAmountCkb} CKB
              </p>
            )}
          </div>
        </section>

        <section style={styles.section}>
          <h4 style={styles.sectionTitle}>Payments</h4>
          <div style={styles.row}>
            <button
              type="button"
              style={styles.actionButton}
              disabled={isCreatingInvoice || !fiber.isRunning}
              onClick={() => {
                void createInvoice();
              }}
            >
              {isCreatingInvoice ? 'Creating...' : 'Create Invoice (1 CKB)'}
            </button>
            {createdInvoice && (
              <span style={styles.compactText}>{shorten(createdInvoice, 18, 10)}</span>
            )}
          </div>
          <div style={styles.row}>
            <input
              style={styles.input}
              value={invoiceInput}
              onChange={(event) => setInvoiceInput(event.target.value)}
              placeholder="Paste invoice to pay"
            />
          </div>
          <div style={{ ...styles.row, marginBottom: 0 }}>
            <button
              type="button"
              style={styles.primaryButton}
              disabled={isPaying || !fiber.isRunning || !invoiceInput.trim()}
              onClick={() => {
                void submitPayment();
              }}
            >
              {isPaying ? 'Paying...' : 'Pay Invoice'}
            </button>
            {paymentResult && (
              <span style={styles.compactText}>Status: {paymentResult.status}</span>
            )}
          </div>
        </section>

        {mergedError && <div style={styles.errorBox}>{mergedError}</div>}
        {channelOpenFlow.diagnostic && (
          <div
            style={{
              ...styles.errorBox,
              borderColor: '#bfdbfe',
              color: '#1d4ed8',
              background: '#eff6ff',
            }}
          >
            {channelOpenFlow.diagnostic}
          </div>
        )}
      </div>
    ),
    [
      channelOpenFlow.diagnostic,
      channelOpenFlow.isOpening,
      channelOpenFlow.lastResult,
      channelOpenFlow.suggestedFundingAmountCkb,
      channelCounts,
      channelFilter,
      closeChannel,
      closingChannelId,
      connectPeerByAddress,
      connectedPeers,
      connectorContext,
      createdInvoice,
      externalFunding?.enabled,
      fiber.isRunning,
      fiber.nodeInfo?.pubkey,
      fiber.state,
      fundingAmountCkb,
      graphChannels,
      graphNodes,
      invoiceInput,
      isConnectingPeer,
      isCreatingInvoice,
      isPaying,
      isRefreshingChannels,
      isRefreshingGraph,
      isRefreshingPeers,
      mergedError,
      openChannel,
      paymentResult,
      peerAddress,
      peerListId,
      peerPubkey,
      refreshChannels,
      refreshConnectedPeers,
      refreshGraph,
      renderConnectorSection,
      submitPayment,
      createInvoice,
      visibleChannels,
    ],
  );

  return (
    <ConnectButton
      fiber={fiber}
      strategy={strategy}
      password={password}
      passkeyUsername={passkeyUsername}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
      onError={handleConnectButtonError}
      className={className}
      style={style}
      dropdownStyle={{ width: 420, ...dropdownStyle }}
      renderConnectedDropdown={renderDropdown}
    />
  );
}
