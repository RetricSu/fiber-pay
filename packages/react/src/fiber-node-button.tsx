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
  useRef,
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
type PanelTab = 'workbench' | 'channels' | 'diagnostics';
type GraphChannelInfo = GraphChannelsResult['channels'][number];
type GraphNodeInfo = GraphNodesResult['nodes'][number];
type PeerInfo = ListPeersResult['peers'][number];

function shorten(value: string, head = 10, tail = 8): string {
  if (!value || value.length <= head + tail + 3) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function summarizeError(message: string, max = 72): string {
  const trimmed = message.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 3)}...`;
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

function withDisabledStyle(style: CSSProperties, disabled: boolean): CSSProperties {
  if (!disabled) {
    return style;
  }
  return {
    ...style,
    opacity: 0.55,
    cursor: 'not-allowed',
  };
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

interface FiberNodeButtonPanelProps {
  dropdownContext: ConnectButtonConnectedDropdownContext;
  network: 'testnet' | 'mainnet';
  fiber: UseFiberNodeResult;
  onLog?: (message: string) => void;
  onError?: (error: string) => void;
  initialPeerPubkey: string;
  initialPeerAddress: string;
  initialFundingAmountCkb: string;
  externalFunding?: FiberNodeButtonExternalFundingConfig;
  renderConnectorSection?: (context: FiberNodeButtonConnectorSectionContext) => ReactNode;
}

const TAB_ITEMS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'workbench', label: 'Workbench' },
  { id: 'channels', label: 'Channels' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

const FILTER_ITEMS: ReadonlyArray<ChannelFilter> = ['active', 'pending', 'closed', 'all'];

const styles = {
  shell: {
    position: 'relative',
    display: 'grid',
    gridTemplateRows: 'auto auto minmax(0, 1fr)',
    gap: '0.7rem',
    minWidth: '280px',
    width: 'min(460px, calc(100vw - 1rem))',
    maxHeight: '72vh',
  } satisfies CSSProperties,

  globalBar: {
    border: '1px solid var(--fpay-border, #d8dee8)',
    borderRadius: '0.72rem',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
    padding: '0.52rem 0.56rem',
    display: 'grid',
    gap: '0.45rem',
  } satisfies CSSProperties,

  globalRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.35rem',
    flexWrap: 'wrap',
  } satisfies CSSProperties,

  globalMetrics: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
    minWidth: 0,
  } satisfies CSSProperties,

  metricInline: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.24rem',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,

  metricDot: {
    display: 'inline-flex',
    width: '0.34rem',
    height: '0.34rem',
    borderRadius: '999px',
    flexShrink: 0,
    background: '#94a3b8',
  } satisfies CSSProperties,

  metricMain: {
    fontSize: '0.82rem',
    fontWeight: 750,
    color: 'var(--fpay-text-primary, #0f172a)',
    lineHeight: 1.1,
  } satisfies CSSProperties,

  metricSub: {
    fontSize: '0.72rem',
    color: 'var(--fpay-text-secondary, #64748b)',
    lineHeight: 1.1,
  } satisfies CSSProperties,

  metricDivider: {
    fontSize: '0.7rem',
    color: '#94a3b8',
    lineHeight: 1,
  } satisfies CSSProperties,

  globalMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    flexWrap: 'wrap',
  } satisfies CSSProperties,

  globalErrorInline: {
    margin: 0,
    fontSize: '0.71rem',
    color: '#9f1239',
    lineHeight: 1.25,
  } satisfies CSSProperties,

  statusDot: {
    display: 'inline-flex',
    width: '0.45rem',
    height: '0.45rem',
    borderRadius: '999px',
    flexShrink: 0,
  } satisfies CSSProperties,

  globalActions: {
    display: 'flex',
    gap: '0.36rem',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  } satisfies CSSProperties,

  globalActionButton: {
    border: '1px solid var(--fpay-border, #cbd5e1)',
    borderRadius: '0.45rem',
    padding: '0.28rem 0.48rem',
    fontSize: '0.72rem',
    fontWeight: 650,
    background: '#fff',
    color: 'var(--fpay-text-primary, #111827)',
    cursor: 'pointer',
  } satisfies CSSProperties,

  tabList: {
    borderRadius: '0.68rem',
    border: 'none',
    background: '#e9eef6',
    padding: '0.14rem',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '0.14rem',
    boxShadow: 'inset 0 0 0 1px var(--fpay-border, #d8dee8)',
  } satisfies CSSProperties,

  tabButton: {
    border: 'none',
    borderRadius: '0.5rem',
    background: 'transparent',
    color: '#334155',
    fontSize: '0.74rem',
    fontWeight: 700,
    padding: '0.44rem 0.45rem',
    cursor: 'pointer',
  } satisfies CSSProperties,

  tabButtonActive: {
    border: 'none',
    borderRadius: '0.5rem',
    background: 'var(--fpay-accent, #1d4ed8)',
    color: '#fff',
    fontSize: '0.74rem',
    fontWeight: 700,
    padding: '0.44rem 0.45rem',
    cursor: 'pointer',
    boxShadow: 'none',
  } satisfies CSSProperties,

  content: {
    overflowY: 'auto',
    paddingRight: '0.15rem',
    display: 'grid',
    gap: '0.7rem',
    minHeight: 0,
  } satisfies CSSProperties,

  section: {
    border: 'none',
    borderBottom: '1px solid var(--fpay-border, #e2e8f0)',
    borderRadius: 0,
    padding: '0.15rem 0 0.55rem',
    background: 'transparent',
    display: 'grid',
    gap: '0.44rem',
  } satisfies CSSProperties,

  sectionTitle: {
    margin: 0,
    fontSize: '0.8rem',
    fontWeight: 750,
    color: 'var(--fpay-text-primary, #0f172a)',
    letterSpacing: '0.01em',
  } satisfies CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
    flexWrap: 'wrap',
  } satisfies CSSProperties,

  rowBetween: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.45rem',
    flexWrap: 'wrap',
  } satisfies CSSProperties,

  compactText: {
    margin: 0,
    fontSize: '0.74rem',
    color: 'var(--fpay-text-secondary, #64748b)',
    lineHeight: 1.4,
  } satisfies CSSProperties,

  inlineCode: {
    margin: 0,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.72rem',
    color: 'var(--fpay-text-primary, #111827)',
    wordBreak: 'break-all',
    lineHeight: 1.4,
  } satisfies CSSProperties,

  fieldLabel: {
    display: 'grid',
    gap: '0.25rem',
    fontSize: '0.68rem',
    fontWeight: 700,
    color: 'var(--fpay-text-secondary, #64748b)',
    textTransform: 'uppercase',
  } satisfies CSSProperties,

  input: {
    width: '100%',
    border: '1px solid var(--fpay-border, #cbd5e1)',
    borderRadius: '0.45rem',
    padding: '0.38rem 0.48rem',
    fontSize: '0.8rem',
    background: '#fff',
    color: 'var(--fpay-text-primary, #0f172a)',
  } satisfies CSSProperties,

  actionButton: {
    border: '1px solid var(--fpay-border, #cbd5e1)',
    borderRadius: '0.45rem',
    padding: '0.35rem 0.55rem',
    fontSize: '0.74rem',
    fontWeight: 650,
    background: '#fff',
    color: 'var(--fpay-text-primary, #111827)',
    cursor: 'pointer',
  } satisfies CSSProperties,

  primaryButton: {
    border: '1px solid var(--fpay-accent, #1d4ed8)',
    borderRadius: '0.45rem',
    padding: '0.35rem 0.55rem',
    fontSize: '0.74rem',
    fontWeight: 750,
    background: 'var(--fpay-accent, #1d4ed8)',
    color: '#fff',
    cursor: 'pointer',
  } satisfies CSSProperties,

  ghostButton: {
    border: '1px solid transparent',
    borderRadius: '0.45rem',
    padding: '0.32rem 0.5rem',
    fontSize: '0.74rem',
    fontWeight: 650,
    background: 'transparent',
    color: 'var(--fpay-text-secondary, #475569)',
    cursor: 'pointer',
  } satisfies CSSProperties,

  dangerButton: {
    border: '1px solid #fecaca',
    borderRadius: '0.45rem',
    padding: '0.35rem 0.55rem',
    fontSize: '0.74rem',
    fontWeight: 750,
    background: '#fff1f2',
    color: '#9f1239',
    cursor: 'pointer',
  } satisfies CSSProperties,

  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    width: 'fit-content',
    borderRadius: '999px',
    border: '1px solid var(--fpay-border, #cbd5e1)',
    background: '#f8fafc',
    color: 'var(--fpay-text-secondary, #475569)',
    padding: '0.12rem 0.4rem',
    fontSize: '0.66rem',
    fontWeight: 700,
    lineHeight: 1.1,
  } satisfies CSSProperties,

  notice: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: '0.52rem',
    padding: '0.46rem 0.52rem',
    fontSize: '0.74rem',
    lineHeight: 1.35,
  } satisfies CSSProperties,

  successNotice: {
    borderColor: '#86efac',
    background: '#f0fdf4',
    color: '#166534',
  } satisfies CSSProperties,

  errorNotice: {
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#9f1239',
    borderRadius: '0.52rem',
    padding: '0.46rem 0.52rem',
    fontSize: '0.74rem',
    lineHeight: 1.35,
  } satisfies CSSProperties,

  summaryGrid: {
    display: 'none',
  } satisfies CSSProperties,

  summaryTile: {
    display: 'none',
  } satisfies CSSProperties,

  summaryValue: {
    display: 'block',
    fontSize: '0.92rem',
    fontWeight: 750,
    color: 'var(--fpay-text-primary, #0f172a)',
    lineHeight: 1.1,
  } satisfies CSSProperties,

  summaryLabel: {
    display: 'block',
    marginTop: '0.12rem',
    fontSize: '0.64rem',
    color: 'var(--fpay-text-secondary, #64748b)',
  } satisfies CSSProperties,

  summaryInline: {
    margin: 0,
    fontSize: '0.76rem',
    color: 'var(--fpay-text-secondary, #475569)',
    lineHeight: 1.35,
  } satisfies CSSProperties,

  filterBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.28rem',
  } satisfies CSSProperties,

  list: {
    display: 'grid',
    gap: '0.34rem',
    maxHeight: '240px',
    overflowY: 'auto',
    paddingRight: '0.1rem',
  } satisfies CSSProperties,

  compactChannelRow: {
    border: '1px solid var(--fpay-border, #d8dee8)',
    borderRadius: '0.5rem',
    background: '#fff',
    padding: '0.42rem 0.46rem',
    cursor: 'pointer',
    display: 'grid',
    gap: '0.22rem',
    textAlign: 'left',
  } satisfies CSSProperties,

  compactChannelRowActive: {
    borderColor: 'var(--fpay-accent, #1d4ed8)',
    boxShadow: '0 0 0 1px rgba(29, 78, 216, 0.12) inset',
    background: '#f8fbff',
  } satisfies CSSProperties,

  compactChannelTop: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    alignItems: 'center',
    gap: '0.35rem',
  } satisfies CSSProperties,

  detailPanel: {
    border: '1px solid var(--fpay-border, #d8dee8)',
    borderRadius: '0.6rem',
    background: '#f8fafc',
    padding: '0.6rem',
    display: 'grid',
    gap: '0.45rem',
  } satisfies CSSProperties,

  dialogBackdrop: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.36)',
    display: 'grid',
    placeItems: 'center',
    padding: '0.75rem',
    zIndex: 3,
  } satisfies CSSProperties,

  dialogCard: {
    width: 'min(100%, 360px)',
    borderRadius: '0.68rem',
    border: '1px solid #fecaca',
    background: '#fff',
    padding: '0.72rem',
    display: 'grid',
    gap: '0.55rem',
  } satisfies CSSProperties,

  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    border: 0,
  } satisfies CSSProperties,
};

function FiberNodeButtonPanel(props: FiberNodeButtonPanelProps) {
  const {
    dropdownContext,
    network,
    fiber,
    onLog,
    onError,
    initialPeerPubkey,
    initialPeerAddress,
    initialFundingAmountCkb,
    externalFunding,
    renderConnectorSection,
  } = props;

  const [activeTab, setActiveTab] = useState<PanelTab>('workbench');

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
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [forceCloseConfirmOpen, setForceCloseConfirmOpen] = useState(false);

  const [invoiceInput, setInvoiceInput] = useState('');
  const [createdInvoice, setCreatedInvoice] = useState('');
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);

  const [latestError, setLatestError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<{
    tone: 'info' | 'success';
    text: string;
  } | null>(null);

  const statusTimerRef = useRef<number | null>(null);
  const peerListId = useId();
  const tabPanelId = useId();

  const channelOpenFlow = useChannelOpenFlow({
    node: fiber.node,
    onLog,
  });

  const { payInvoice, isPaying, paymentResult, error: paymentError } = useFiberPayment(fiber.node);

  const isNodeReady = fiber.isRunning && !!fiber.node;

  useEffect(() => {
    return () => {
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const flashStatus = useCallback((text: string, tone: 'info' | 'success' = 'info') => {
    setStatusNotice({ tone, text });
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = window.setTimeout(() => {
      setStatusNotice(null);
      statusTimerRef.current = null;
    }, 3200);
  }, []);

  const reportError = useCallback(
    (message: string) => {
      setLatestError(message);
      onError?.(message);
      onLog?.(`fiber_panel_error_shown: ${summarizeError(message, 120)}`);
    },
    [onError, onLog],
  );

  const refreshConnectedPeers = useCallback(async () => {
    if (!fiber.node) {
      setConnectedPeers([]);
      return;
    }

    setIsRefreshingPeers(true);

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

  const refreshChannels = useCallback(async () => {
    if (!fiber.node) {
      setChannels([]);
      return;
    }

    setIsRefreshingChannels(true);

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

      try {
        const latest = await fiber.node.listChannels({ include_closed: true });
        const target = latest.channels.find((item) => item.channel_id === channelId);

        if (!target) {
          throw new Error(`Channel not found in latest snapshot: ${channelId}.`);
        }

        if (target.state.state_name === ChannelState.Closed) {
          setChannels(latest.channels);
          flashStatus('Channel is already closed.', 'info');
          onLog?.(`Channel already closed: ${channelId}`);
          return;
        }

        if (target.state.state_name === ChannelState.ShuttingDown) {
          setChannels(latest.channels);
          flashStatus('Channel is already shutting down.', 'info');
          onLog?.(`Channel is already shutting down: ${channelId}`);
          return;
        }

        if (isPendingChannelState(target.state.state_name)) {
          const params: AbandonChannelParams = {
            channel_id: channelId as HexString,
          };
          await fiber.node.abandonChannel(params);
          flashStatus('Pending channel abandoned.', 'success');
          onLog?.(`Pending channel abandoned: ${channelId}`);
        } else {
          const params: ShutdownChannelParams = {
            channel_id: channelId as HexString,
            force,
          };
          await fiber.node.shutdownChannel(params);
          flashStatus(force ? 'Force close requested.' : 'Close requested.', 'success');
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
    [fiber.node, flashStatus, onLog, refreshChannels, reportError],
  );

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

    try {
      await fiber.node.connectPeer({
        address: peerAddress.trim(),
        save: true,
      });
      flashStatus('Peer connected.', 'success');
      onLog?.('Peer connected from address input.');
      await refreshConnectedPeers();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
      onLog?.(`Connect peer failed: ${message}`);
    } finally {
      setIsConnectingPeer(false);
    }
  }, [fiber.node, flashStatus, onLog, peerAddress, refreshConnectedPeers, reportError]);

  const openChannel = useCallback(async () => {
    if (!fiber.node) {
      reportError('Node is not connected.');
      return;
    }

    if (!peerPubkey.trim()) {
      reportError('Target peer pubkey is empty.');
      return;
    }

    channelOpenFlow.reset();

    try {
      const pubkey = toHexPrefixed(peerPubkey);

      if (!externalFunding?.enabled) {
        const openResult = await channelOpenFlow.openChannel({
          pubkey,
          fundingAmountCkb,
          externalWallet: false,
        });
        if (!openResult) {
          return;
        }
        flashStatus('Open channel submitted.', 'success');
        onLog?.('fiber_panel_primary_action_clicked: open_channel');
        await refreshChannels();
        return;
      }

      const resolved = await externalFunding.resolve({
        node: fiber.node,
        pubkey,
        fundingAmountCkb,
      });

      const openResult = await channelOpenFlow.openChannel({
        pubkey,
        fundingAmountCkb,
        externalWallet: true,
        shutdownScript: resolved.shutdownScript,
        fundingLockScript: resolved.fundingLockScript,
        fundingLockScriptCellDeps: resolved.fundingLockScriptCellDeps,
        signFundingTx: resolved.signFundingTx,
        ckbRpcUrl: resolved.ckbRpcUrl,
      });
      if (!openResult) {
        return;
      }
      flashStatus('Open channel submitted.', 'success');
      onLog?.('fiber_panel_primary_action_clicked: open_channel');
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
    flashStatus,
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

    try {
      const created = await fiber.node.newInvoice({
        amount: ONE_CKB_SHANNONS,
        currency: network === 'mainnet' ? 'Fibb' : 'Fibt',
        description: 'FiberNodeButton invoice',
      });
      setCreatedInvoice(created.invoice_address);
      flashStatus('Invoice created.', 'success');
      onLog?.('fiber_panel_primary_action_clicked: create_invoice');
      onLog?.(`Invoice created: ${shorten(created.invoice_address, 20, 8)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
    } finally {
      setIsCreatingInvoice(false);
    }
  }, [fiber.node, flashStatus, network, onLog, reportError]);

  const submitPayment = useCallback(async () => {
    if (!invoiceInput.trim()) {
      reportError('Invoice is empty.');
      return;
    }

    onLog?.('fiber_panel_primary_action_clicked: pay_invoice');
    await payInvoice(invoiceInput);
  }, [invoiceInput, onLog, payInvoice, reportError]);

  useEffect(() => {
    if (!fiber.isRunning || !fiber.node) {
      setConnectedPeers([]);
      setGraphNodes([]);
      setGraphChannels([]);
      setChannels([]);
      setSelectedChannelId(null);
      return;
    }

    void refreshConnectedPeers();
    void refreshGraph();
    void refreshChannels();
  }, [fiber.isRunning, fiber.node, refreshChannels, refreshConnectedPeers, refreshGraph]);

  useEffect(() => {
    if (paymentError) {
      reportError(paymentError);
    }
  }, [paymentError, reportError]);

  useEffect(() => {
    if (channelOpenFlow.error) {
      reportError(channelOpenFlow.error);
    }
  }, [channelOpenFlow.error, reportError]);

  useEffect(() => {
    if (!paymentResult) {
      return;
    }

    flashStatus(`Payment ${paymentResult.status}.`, 'success');
    onLog?.(`Payment status: ${paymentResult.status}`);
  }, [flashStatus, onLog, paymentResult]);

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

  const activeChannelCount = channelCounts.active;

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.channel_id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );

  useEffect(() => {
    if (!selectedChannelId) {
      return;
    }
    if (!channels.some((channel) => channel.channel_id === selectedChannelId)) {
      setSelectedChannelId(null);
      setForceCloseConfirmOpen(false);
    }
  }, [channels, selectedChannelId]);

  useEffect(() => {
    const isSelectedVisible = selectedChannelId
      ? visibleChannels.some((channel) => channel.channel_id === selectedChannelId)
      : false;

    if (!isSelectedVisible) {
      setSelectedChannelId(visibleChannels[0]?.channel_id ?? null);
      setForceCloseConfirmOpen(false);
    }
  }, [selectedChannelId, visibleChannels]);

  useEffect(() => {
    if (!forceCloseConfirmOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setForceCloseConfirmOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [forceCloseConfirmOpen]);

  const selectedState = selectedChannel?.state.state_name;
  const selectedPending = selectedChannel
    ? isPendingChannelState(selectedState as ChannelState)
    : false;
  const selectedCanClose =
    !!selectedChannel &&
    selectedState !== ChannelState.Closed &&
    selectedState !== ChannelState.ShuttingDown;
  const selectedIsClosing = !!selectedChannel && closingChannelId === selectedChannel.channel_id;

  const connectorContext: FiberNodeButtonConnectorSectionContext = useMemo(
    () => ({
      fiber,
      externalFundingEnabled: !!externalFunding?.enabled,
      isOpeningChannel: channelOpenFlow.isOpening,
    }),
    [channelOpenFlow.isOpening, externalFunding?.enabled, fiber],
  );

  const switchTab = useCallback(
    (next: PanelTab) => {
      setActiveTab(next);
      onLog?.(`fiber_panel_tab_switched: ${next}`);
    },
    [onLog],
  );

  const refreshDiagnostics = useCallback(async () => {
    await Promise.all([refreshConnectedPeers(), refreshGraph()]);
    flashStatus('Diagnostics refreshed.', 'info');
  }, [flashStatus, refreshConnectedPeers, refreshGraph]);

  return (
    <div style={styles.shell}>
      <header style={styles.globalBar}>
        <div style={styles.globalRow}>
          <div style={styles.globalMetrics}>
            <span style={styles.metricInline}>
              <span
                style={{
                  ...styles.metricDot,
                  background:
                    fiber.state === 'running'
                      ? '#16a34a'
                      : fiber.state === 'error'
                        ? '#dc2626'
                        : '#64748b',
                }}
                aria-hidden="true"
              />
              <span style={styles.metricMain}>{fiber.state}</span>
              <span style={styles.metricSub}>Node</span>
            </span>

            <span style={styles.metricDivider} aria-hidden="true">
              |
            </span>

            <span style={styles.metricInline}>
              <span style={styles.metricMain}>
                {externalFunding?.enabled ? 'External' : 'Internal'}
              </span>
              <span style={styles.metricSub}>Funding</span>
            </span>

            <span style={styles.metricDivider} aria-hidden="true">
              |
            </span>

            <span style={styles.metricInline}>
              <span style={styles.metricMain}>{activeChannelCount}</span>
              <span style={styles.metricSub}>Active</span>
            </span>

            <span style={styles.metricDivider} aria-hidden="true">
              |
            </span>

            <span style={styles.metricInline}>
              <span style={styles.metricMain}>{connectedPeers.length}</span>
              <span style={styles.metricSub}>Peers</span>
            </span>

            {latestError ? (
              <>
                <span style={styles.metricDivider} aria-hidden="true">
                  |
                </span>
                <span style={styles.metricInline}>
                  <span
                    style={{
                      ...styles.metricDot,
                      background: '#dc2626',
                    }}
                    aria-hidden="true"
                  />
                  <span style={styles.metricMain}>Error</span>
                </span>
              </>
            ) : null}
          </div>

          <div style={styles.globalActions}>
            <button
              type="button"
              style={styles.globalActionButton}
              onClick={() => {
                void dropdownContext.disconnect();
              }}
              aria-label="Disconnect node"
            >
              Disconnect
            </button>
            <button
              type="button"
              style={styles.globalActionButton}
              onClick={() => {
                dropdownContext.closeDropdown();
              }}
              aria-label="Close panel"
            >
              Close Panel
            </button>
          </div>
        </div>

        <div style={styles.globalMeta}>
          <p style={styles.inlineCode}>
            Node: {fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey, 18, 12) : 'N/A'}
          </p>
          {latestError ? (
            <p style={styles.globalErrorInline}>Recent error: {summarizeError(latestError, 92)}</p>
          ) : null}
        </div>
      </header>

      <div role="tablist" aria-label="Fiber panel tabs" style={styles.tabList}>
        {TAB_ITEMS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`${tabPanelId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? `${tabPanelId}-panel-${tab.id}` : undefined}
              style={selected ? styles.tabButtonActive : styles.tabButton}
              onClick={() => switchTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id={`${tabPanelId}-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`${tabPanelId}-tab-${activeTab}`}
        style={styles.content}
      >
        {statusNotice ? (
          <div
            style={{
              ...styles.notice,
              ...(statusNotice.tone === 'success' ? styles.successNotice : {}),
            }}
          >
            {statusNotice.text}
          </div>
        ) : null}

        {activeTab === 'workbench' ? (
          <>
            <section style={styles.section}>
              <div style={styles.rowBetween}>
                <h4 style={styles.sectionTitle}>Connection Prep</h4>
                <span style={styles.badge}>{isNodeReady ? 'Connected' : 'Disconnected'}</span>
              </div>
              <p style={styles.compactText}>
                Node: {fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey, 18, 12) : 'N/A'}
              </p>
              <p style={styles.compactText}>
                External wallet: {externalFunding?.enabled ? 'Enabled' : 'Disabled'}
              </p>

              {renderConnectorSection ? (
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.55rem' }}>
                  {renderConnectorSection(connectorContext)}
                </div>
              ) : null}
            </section>

            <section style={styles.section}>
              <div style={styles.rowBetween}>
                <h4 style={styles.sectionTitle}>Open Channel</h4>
                {channelOpenFlow.lastResult ? (
                  <span style={styles.badge}>Recent Success</span>
                ) : null}
              </div>

              <label style={styles.fieldLabel}>
                Target Peer Pubkey
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
                Funding Amount (CKB)
                <input
                  style={styles.input}
                  value={fundingAmountCkb}
                  onChange={(event) => setFundingAmountCkb(event.target.value)}
                  placeholder="1000"
                />
              </label>

              <div style={styles.row}>
                <button
                  type="button"
                  style={withDisabledStyle(
                    styles.primaryButton,
                    !isNodeReady || channelOpenFlow.isOpening || !peerPubkey.trim(),
                  )}
                  disabled={!isNodeReady || channelOpenFlow.isOpening || !peerPubkey.trim()}
                  onClick={() => {
                    void openChannel();
                  }}
                >
                  {channelOpenFlow.isOpening ? 'Opening...' : 'Open Channel'}
                </button>
              </div>

              {channelOpenFlow.lastResult ? (
                <p style={styles.compactText}>
                  Last channel: {shorten(channelOpenFlow.lastResult.channelId, 14, 8)}
                </p>
              ) : null}

              {channelOpenFlow.suggestedFundingAmountCkb ? (
                <p style={styles.compactText}>
                  Suggested amount: {channelOpenFlow.suggestedFundingAmountCkb} CKB
                </p>
              ) : null}
            </section>

            <section style={styles.section}>
              <h4 style={styles.sectionTitle}>Payments</h4>

              <div style={styles.row}>
                <button
                  type="button"
                  style={withDisabledStyle(styles.actionButton, isCreatingInvoice || !isNodeReady)}
                  disabled={isCreatingInvoice || !isNodeReady}
                  onClick={() => {
                    void createInvoice();
                  }}
                >
                  {isCreatingInvoice ? 'Creating...' : 'Create Invoice (1 CKB)'}
                </button>
                {createdInvoice ? (
                  <span style={styles.compactText}>{shorten(createdInvoice, 20, 10)}</span>
                ) : null}
              </div>

              <label style={styles.fieldLabel}>
                Invoice
                <input
                  style={styles.input}
                  value={invoiceInput}
                  onChange={(event) => setInvoiceInput(event.target.value)}
                  placeholder="Paste invoice to pay"
                />
              </label>

              <div style={styles.rowBetween}>
                <button
                  type="button"
                  style={withDisabledStyle(
                    styles.primaryButton,
                    isPaying || !isNodeReady || !invoiceInput.trim(),
                  )}
                  disabled={isPaying || !isNodeReady || !invoiceInput.trim()}
                  onClick={() => {
                    void submitPayment();
                  }}
                >
                  {isPaying ? 'Paying...' : 'Pay Invoice'}
                </button>

                <span style={styles.compactText}>Status: {paymentResult?.status ?? 'Idle'}</span>
              </div>
            </section>
          </>
        ) : null}

        {activeTab === 'channels' ? (
          <>
            <section style={styles.section}>
              <div style={styles.rowBetween}>
                <h4 style={styles.sectionTitle}>Channel Summary</h4>
                <button
                  type="button"
                  style={withDisabledStyle(styles.actionButton, isRefreshingChannels)}
                  disabled={isRefreshingChannels}
                  onClick={() => {
                    void refreshChannels();
                  }}
                >
                  {isRefreshingChannels ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              <p style={styles.summaryInline}>
                Active {channelCounts.active} | Pending {channelCounts.pending} | Closed{' '}
                {channelCounts.closed} | Total {channelCounts.all}
              </p>

              <div style={styles.filterBar}>
                {FILTER_ITEMS.map((filter) => (
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

              <div style={styles.list}>
                {visibleChannels.length === 0 ? (
                  <p style={styles.compactText}>No channels found for this filter.</p>
                ) : (
                  visibleChannels.map((channel) => {
                    const selected = channel.channel_id === selectedChannelId;

                    return (
                      <button
                        key={channel.channel_id}
                        type="button"
                        style={{
                          ...styles.compactChannelRow,
                          ...(selected ? styles.compactChannelRowActive : {}),
                        }}
                        onClick={() => {
                          setSelectedChannelId(channel.channel_id);
                          setForceCloseConfirmOpen(false);
                        }}
                      >
                        <span style={styles.srOnly}>
                          {selected ? 'Selected channel' : 'Select channel'}
                        </span>
                        <span style={styles.compactChannelTop}>
                          <span style={styles.inlineCode}>
                            ID: {shorten(channel.channel_id, 12, 8)}
                          </span>
                          <span style={styles.badge}>{channel.state.state_name}</span>
                        </span>
                        <span style={styles.compactText}>
                          Peer: {shorten(channel.pubkey, 16, 10)}
                        </span>
                        <span style={styles.compactText}>
                          L {formatChannelBalance(channel.local_balance)} / R{' '}
                          {formatChannelBalance(channel.remote_balance)} CKB
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            {selectedChannel ? (
              <section style={styles.detailPanel}>
                <div style={styles.rowBetween}>
                  <h4 style={styles.sectionTitle}>Channel Details</h4>
                  <span style={styles.badge}>{selectedChannel.state.state_name}</span>
                </div>

                <p style={styles.inlineCode}>Channel ID: {selectedChannel.channel_id}</p>
                <p style={styles.inlineCode}>Peer: {selectedChannel.pubkey}</p>

                <div style={styles.row}>
                  <span style={styles.badge}>
                    Local {formatChannelBalance(selectedChannel.local_balance)} CKB
                  </span>
                  <span style={styles.badge}>
                    Remote {formatChannelBalance(selectedChannel.remote_balance)} CKB
                  </span>
                  <span
                    style={styles.badge}
                    title="Pending TLCs are in-flight payment locks associated with this channel."
                  >
                    TLCs {selectedChannel.pending_tlcs.length}
                  </span>
                </div>

                {selectedChannel.failure_detail ? (
                  <p style={styles.compactText}>Failure: {selectedChannel.failure_detail}</p>
                ) : null}

                {selectedChannel.shutdown_transaction_hash ? (
                  <p style={styles.inlineCode}>
                    Shutdown TX: {selectedChannel.shutdown_transaction_hash}
                  </p>
                ) : null}

                <div style={{ ...styles.row, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    style={withDisabledStyle(
                      styles.actionButton,
                      !selectedCanClose || selectedIsClosing,
                    )}
                    disabled={!selectedCanClose || selectedIsClosing}
                    onClick={() => {
                      if (!selectedChannel) {
                        return;
                      }
                      void closeChannel(selectedChannel.channel_id, false);
                    }}
                  >
                    {selectedIsClosing
                      ? 'Closing...'
                      : selectedPending
                        ? 'Abandon Pending'
                        : 'Close Channel'}
                  </button>

                  <button
                    type="button"
                    style={withDisabledStyle(
                      styles.dangerButton,
                      !selectedCanClose || selectedPending || selectedIsClosing,
                    )}
                    disabled={!selectedCanClose || selectedPending || selectedIsClosing}
                    onClick={() => {
                      setForceCloseConfirmOpen(true);
                      onLog?.('fiber_channel_force_close_confirm_opened');
                    }}
                  >
                    Force Close
                  </button>
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {activeTab === 'diagnostics' ? (
          <>
            <section style={styles.section}>
              <div style={styles.rowBetween}>
                <h4 style={styles.sectionTitle}>Connected Peers</h4>
                <button
                  type="button"
                  style={withDisabledStyle(styles.actionButton, isRefreshingPeers)}
                  disabled={isRefreshingPeers}
                  onClick={() => {
                    void refreshConnectedPeers();
                  }}
                >
                  {isRefreshingPeers ? 'Refreshing...' : 'Refresh Peers'}
                </button>
              </div>

              <p style={styles.compactText}>Peers: {connectedPeers.length}</p>

              <div style={{ ...styles.list, maxHeight: '190px' }}>
                {connectedPeers.length === 0 ? (
                  <p style={styles.compactText}>No connected peers.</p>
                ) : (
                  connectedPeers.map((peer) => (
                    <article key={peer.pubkey} style={styles.compactChannelRow}>
                      <p style={styles.inlineCode}>{shorten(peer.pubkey, 18, 12)}</p>
                      <details>
                        <summary style={{ ...styles.compactText, cursor: 'pointer' }}>
                          Address
                        </summary>
                        <p style={styles.inlineCode}>{peer.address}</p>
                      </details>
                      <div style={styles.row}>
                        <button
                          type="button"
                          style={styles.ghostButton}
                          onClick={() => {
                            setPeerPubkey(peer.pubkey);
                            switchTab('workbench');
                          }}
                        >
                          Use for Open Channel
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>

              <label style={styles.fieldLabel}>
                Connect Peer Address
                <input
                  style={styles.input}
                  value={peerAddress}
                  onChange={(event) => setPeerAddress(event.target.value)}
                  placeholder="/dns4/.../wss/p2p/..."
                />
              </label>

              <div style={styles.rowBetween}>
                <button
                  type="button"
                  style={withDisabledStyle(
                    styles.primaryButton,
                    isConnectingPeer || !peerAddress.trim(),
                  )}
                  disabled={isConnectingPeer || !peerAddress.trim()}
                  onClick={() => {
                    void connectPeerByAddress();
                  }}
                >
                  {isConnectingPeer ? 'Connecting...' : 'Connect Peer'}
                </button>

                <button
                  type="button"
                  style={withDisabledStyle(
                    styles.actionButton,
                    isRefreshingPeers || isRefreshingGraph,
                  )}
                  disabled={isRefreshingPeers || isRefreshingGraph}
                  onClick={() => {
                    void refreshDiagnostics();
                  }}
                >
                  {isRefreshingPeers || isRefreshingGraph ? 'Refreshing...' : 'Refresh All'}
                </button>
              </div>
            </section>

            <section style={styles.section}>
              <div style={styles.rowBetween}>
                <h4 style={styles.sectionTitle}>Graph Snapshot</h4>
                <button
                  type="button"
                  style={withDisabledStyle(styles.actionButton, isRefreshingGraph)}
                  disabled={isRefreshingGraph}
                  onClick={() => {
                    void refreshGraph();
                  }}
                >
                  {isRefreshingGraph ? 'Refreshing...' : 'Refresh Graph'}
                </button>
              </div>

              <p style={styles.compactText}>
                showing {Math.min(graphNodes.length, 3)} of {graphNodes.length} nodes,{' '}
                {Math.min(graphChannels.length, 2)} of {graphChannels.length} channels.
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
                  {shorten(channel.node1, 10, 6)} to {shorten(channel.node2, 10, 6)};{' '}
                  {formatChannelBalance(channel.capacity)} CKB
                </p>
              ))}

              <details>
                <summary style={{ ...styles.compactText, cursor: 'pointer' }}>
                  Raw graph snapshot
                </summary>
                <pre
                  style={{
                    ...styles.inlineCode,
                    marginTop: '0.45rem',
                    maxHeight: '160px',
                    overflow: 'auto',
                    background: '#f1f5f9',
                    borderRadius: '0.45rem',
                    padding: '0.45rem',
                  }}
                >
                  {JSON.stringify(
                    {
                      nodes: graphNodes,
                      channels: graphChannels,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </section>

            {channelOpenFlow.diagnostic ? (
              <div style={styles.notice}>{channelOpenFlow.diagnostic}</div>
            ) : null}
          </>
        ) : null}

        {latestError ? <div style={styles.errorNotice}>{latestError}</div> : null}
      </div>

      {forceCloseConfirmOpen && selectedChannel ? (
        <div style={styles.dialogBackdrop}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Force close confirmation"
            style={styles.dialogCard}
          >
            <h4 style={styles.sectionTitle}>Force close this channel?</h4>
            <p style={styles.compactText}>
              This action may immediately broadcast a unilateral close transaction, can lock
              liquidity until settlement, and may produce additional fees. Continue only if normal
              close cannot proceed.
            </p>
            <p style={styles.inlineCode}>Channel: {shorten(selectedChannel.channel_id, 20, 12)}</p>
            <div style={{ ...styles.row, justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={styles.actionButton}
                onClick={() => {
                  setForceCloseConfirmOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.dangerButton}
                onClick={() => {
                  setForceCloseConfirmOpen(false);
                  onLog?.('fiber_channel_force_close_confirmed');
                  void closeChannel(selectedChannel.channel_id, true);
                }}
              >
                Confirm Force Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

  const handleConnectButtonError = useCallback(
    (error: string) => {
      onError?.(error);
    },
    [onError],
  );

  const renderDropdown = useCallback(
    (dropdownContext: ConnectButtonConnectedDropdownContext) => (
      <FiberNodeButtonPanel
        dropdownContext={dropdownContext}
        network={network}
        fiber={fiber}
        onLog={onLog}
        onError={onError}
        initialPeerPubkey={initialPeerPubkey}
        initialPeerAddress={initialPeerAddress}
        initialFundingAmountCkb={initialFundingAmountCkb}
        externalFunding={externalFunding}
        renderConnectorSection={renderConnectorSection}
      />
    ),
    [
      externalFunding,
      fiber,
      initialFundingAmountCkb,
      initialPeerAddress,
      initialPeerPubkey,
      network,
      onError,
      onLog,
      renderConnectorSection,
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
      dropdownStyle={{ maxWidth: 460, width: 'calc(100vw - 1rem)', ...dropdownStyle }}
      renderConnectedDropdown={renderDropdown}
    />
  );
}
