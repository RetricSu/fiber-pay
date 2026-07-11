import type {
  AbandonChannelParams,
  Channel,
  GetPaymentResult,
  HexString,
  ShutdownChannelParams,
  UdtTypeScript,
} from '@fiber-pay/sdk/browser';
import {
  areUdtTypeScriptsEqual,
  ChannelState,
  DEFAULT_CKB_ASSET,
  validateUdtTypeScript,
} from '@fiber-pay/sdk/browser';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { buildNewInvoiceParams } from '../invoice-params.js';
import { type UseChannelOpenFlowResult, useChannelOpenFlow } from '../use-channel-open-flow.js';
import { useFiberPayment } from '../use-fiber-payment.js';
import type {
  ChannelFilter,
  FiberNodeButtonConnectorSectionContext,
  FiberNodeButtonPanelProps,
  GraphChannelInfo,
  GraphNodeInfo,
  PanelTab,
  PeerInfo,
} from './types.js';
import {
  getChannelFilterState,
  isPendingChannelState,
  shorten,
  summarizeError,
  toHexPrefixed,
} from './utils.js';

export interface PanelStatusNotice {
  tone: 'info' | 'success';
  text: string;
}

export interface PanelChannelCounts {
  active: number;
  pending: number;
  closed: number;
  all: number;
}

export interface FiberNodeButtonPanelState {
  activeTab: PanelTab;
  switchTab: (next: PanelTab) => void;
  tabPanelId: string;
  peerPubkey: string;
  setPeerPubkey: Dispatch<SetStateAction<string>>;
  peerAddress: string;
  setPeerAddress: Dispatch<SetStateAction<string>>;
  fundingAmount: string;
  setFundingAmount: Dispatch<SetStateAction<string>>;
  /** @deprecated Use `fundingAmount` instead. */
  fundingAmountCkb: string;
  invoiceAmount: string;
  setInvoiceAmount: Dispatch<SetStateAction<string>>;
  peerListId: string;
  connectedPeers: PeerInfo[];
  isRefreshingPeers: boolean;
  isConnectingPeer: boolean;
  refreshConnectedPeers: () => Promise<void>;
  connectPeerByAddress: () => Promise<void>;
  graphNodes: GraphNodeInfo[];
  graphChannels: GraphChannelInfo[];
  isRefreshingGraph: boolean;
  refreshGraph: () => Promise<void>;
  channels: Channel[];
  channelFilter: ChannelFilter;
  setChannelFilter: Dispatch<SetStateAction<ChannelFilter>>;
  isRefreshingChannels: boolean;
  refreshChannels: () => Promise<void>;
  closeChannel: (channelId: string, force?: boolean) => Promise<void>;
  selectedChannelId: string | null;
  setSelectedChannelId: Dispatch<SetStateAction<string | null>>;
  selectedChannel: Channel | null;
  selectedPending: boolean;
  selectedCanClose: boolean;
  selectedIsClosing: boolean;
  forceCloseConfirmOpen: boolean;
  setForceCloseConfirmOpen: Dispatch<SetStateAction<boolean>>;
  channelCounts: PanelChannelCounts;
  visibleChannels: Channel[];
  activeChannelCount: number;
  invoiceInput: string;
  setInvoiceInput: Dispatch<SetStateAction<string>>;
  createdInvoice: string;
  isCreatingInvoice: boolean;
  createInvoice: () => Promise<void>;
  submitPayment: () => Promise<void>;
  isPaying: boolean;
  paymentResult: GetPaymentResult | null;
  channelOpenFlow: UseChannelOpenFlowResult;
  openChannel: () => Promise<void>;
  latestError: string | null;
  statusNotice: PanelStatusNotice | null;
  refreshDiagnostics: () => Promise<void>;
  isNodeReady: boolean;
  connectorContext: FiberNodeButtonConnectorSectionContext;
}

function getAssetIdentity(asset: FiberNodeButtonPanelProps['asset']): string {
  if (!asset || asset.kind === 'ckb') {
    return 'ckb';
  }
  return `${asset.script.code_hash}:${asset.script.hash_type}:${asset.script.args}`.toLowerCase();
}

export function useFiberNodeButtonPanelState(
  props: FiberNodeButtonPanelProps,
): FiberNodeButtonPanelState {
  const {
    network,
    fiber,
    asset = DEFAULT_CKB_ASSET,
    onLog,
    onError,
    initialPeerPubkey,
    initialPeerAddress,
    initialFundingAmountCkb,
    initialFundingAmount,
    invoiceAmount: initialInvoiceAmount,
    externalFunding,
  } = props;

  const [activeTab, setActiveTab] = useState<PanelTab>('workbench');

  const [peerPubkey, setPeerPubkey] = useState(initialPeerPubkey);
  const [peerAddress, setPeerAddress] = useState(initialPeerAddress);
  const [fundingAmount, setFundingAmount] = useState(
    initialFundingAmount ?? initialFundingAmountCkb ?? '1000',
  );
  const [invoiceAmount, setInvoiceAmount] = useState(initialInvoiceAmount ?? '1');

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
  const [statusNotice, setStatusNotice] = useState<PanelStatusNotice | null>(null);

  const statusTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const previousAssetIdentityRef = useRef(getAssetIdentity(asset));
  const peerListId = useId();
  const tabPanelId = useId();

  const channelOpenFlow = useChannelOpenFlow({
    node: fiber.node,
    onLog,
  });

  const paymentOptions = useMemo(() => ({ asset, network }), [asset, network]);

  const {
    payInvoice,
    isPaying,
    paymentResult,
    error: paymentError,
  } = useFiberPayment(fiber.node, paymentOptions);

  const isNodeReady = fiber.isRunning && !!fiber.node;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const nextIdentity = getAssetIdentity(asset);
    if (previousAssetIdentityRef.current === nextIdentity) {
      return;
    }

    previousAssetIdentityRef.current = nextIdentity;
    setFundingAmount(initialFundingAmount ?? initialFundingAmountCkb ?? '1000');
    setInvoiceAmount(initialInvoiceAmount ?? '1');
    setInvoiceInput('');
    setCreatedInvoice('');
    setLatestError(null);
  }, [asset, initialFundingAmount, initialFundingAmountCkb, initialInvoiceAmount]);

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

  const ensureAssetConfigured = useCallback(() => {
    if (asset.kind !== 'udt') {
      return true;
    }

    let validatedScript: UdtTypeScript;
    try {
      validatedScript = validateUdtTypeScript(asset.script);
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error));
      return false;
    }

    const configuredUdts = fiber.nodeInfo?.udt_cfg_infos ?? [];

    if (configuredUdts.some((entry) => areUdtTypeScriptsEqual(entry.script, validatedScript))) {
      return true;
    }

    reportError(
      `UDT asset ${asset.name?.trim() || 'UDT'} is not present in the node whitelist. Configure nodeConfig.udtWhitelist with the same type script and cell deps before using it.`,
    );
    return false;
  }, [asset, fiber.nodeInfo?.udt_cfg_infos, reportError]);

  const refreshConnectedPeers = useCallback(async () => {
    if (!fiber.node) {
      if (mountedRef.current) {
        setConnectedPeers([]);
      }
      return;
    }

    if (!mountedRef.current) {
      return;
    }

    setIsRefreshingPeers(true);

    try {
      const peers = await fiber.node.listPeers();
      if (!mountedRef.current) {
        return;
      }
      setConnectedPeers(peers.peers);
      setPeerPubkey((prev) => (prev.trim() ? prev : (peers.peers[0]?.pubkey ?? prev)));
      onLog?.(`Loaded connected peers: ${peers.peers.length}.`);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
      onLog?.(`Refresh peers failed: ${message}`);
    } finally {
      if (mountedRef.current) {
        setIsRefreshingPeers(false);
      }
    }
  }, [fiber.node, onLog, reportError]);

  const refreshGraph = useCallback(async () => {
    if (!fiber.node) {
      if (mountedRef.current) {
        setGraphNodes([]);
        setGraphChannels([]);
      }
      return;
    }

    if (!mountedRef.current) {
      return;
    }

    setIsRefreshingGraph(true);

    try {
      const [nodesResult, channelsResult] = await Promise.all([
        fiber.node.graphNodes({ limit: '0x8' }),
        fiber.node.graphChannels({ limit: '0x8' }),
      ]);
      if (!mountedRef.current) {
        return;
      }
      setGraphNodes(nodesResult.nodes);
      setGraphChannels(channelsResult.channels);
      onLog?.(
        `Loaded graph: ${nodesResult.nodes.length} nodes, ${channelsResult.channels.length} channels.`,
      );
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
      onLog?.(`Refresh graph failed: ${message}`);
    } finally {
      if (mountedRef.current) {
        setIsRefreshingGraph(false);
      }
    }
  }, [fiber.node, onLog, reportError]);

  const refreshChannels = useCallback(async () => {
    if (!fiber.node) {
      if (mountedRef.current) {
        setChannels([]);
      }
      return;
    }

    if (!mountedRef.current) {
      return;
    }

    setIsRefreshingChannels(true);

    try {
      const result = await fiber.node.listChannels({ include_closed: true });
      if (!mountedRef.current) {
        return;
      }
      setChannels(result.channels);
      onLog?.(`Loaded channels: ${result.channels.length}.`);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
      onLog?.(`Refresh channels failed: ${message}`);
    } finally {
      if (mountedRef.current) {
        setIsRefreshingChannels(false);
      }
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

    if (!ensureAssetConfigured()) {
      return;
    }

    channelOpenFlow.reset();

    try {
      const pubkey = toHexPrefixed(peerPubkey);

      if (!externalFunding?.enabled) {
        const openResult = await channelOpenFlow.openChannel({
          pubkey,
          fundingAmount,
          externalWallet: false,
          asset,
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
        asset,
        fundingAmount,
        fundingAmountCkb: fundingAmount,
      });

      const openResult = await channelOpenFlow.openChannel({
        pubkey,
        fundingAmount,
        externalWallet: true,
        asset,
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
    asset,
    channelOpenFlow,
    externalFunding,
    ensureAssetConfigured,
    fiber.node,
    flashStatus,
    fundingAmount,
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

    if (!ensureAssetConfigured()) {
      return;
    }

    setIsCreatingInvoice(true);

    try {
      const amountInput = invoiceAmount.trim();
      const params = buildNewInvoiceParams({
        amountInput,
        asset,
        network,
        descriptionPrefix: 'FiberNodeButton invoice',
      });
      const created = await fiber.node.newInvoice(params);
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
  }, [
    asset,
    ensureAssetConfigured,
    fiber.node,
    flashStatus,
    invoiceAmount,
    network,
    onLog,
    reportError,
  ]);

  const submitPayment = useCallback(async () => {
    const normalizedInvoice = invoiceInput.trim();
    if (!normalizedInvoice) {
      reportError('Invoice is empty.');
      return;
    }

    if (!ensureAssetConfigured()) {
      return;
    }

    onLog?.('fiber_panel_primary_action_clicked: pay_invoice');
    await payInvoice(normalizedInvoice);
  }, [ensureAssetConfigured, invoiceInput, onLog, payInvoice, reportError]);

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
      asset,
      externalFundingEnabled: !!externalFunding?.enabled,
      isOpeningChannel: channelOpenFlow.isOpening,
    }),
    [asset, channelOpenFlow.isOpening, externalFunding?.enabled, fiber],
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

  return {
    // tab
    activeTab,
    switchTab,
    tabPanelId,
    // inputs
    peerPubkey,
    setPeerPubkey,
    peerAddress,
    setPeerAddress,
    fundingAmount,
    setFundingAmount,
    fundingAmountCkb: fundingAmount,
    invoiceAmount,
    setInvoiceAmount,
    peerListId,
    // peers
    connectedPeers,
    isRefreshingPeers,
    isConnectingPeer,
    refreshConnectedPeers,
    connectPeerByAddress,
    // graph
    graphNodes,
    graphChannels,
    isRefreshingGraph,
    refreshGraph,
    // channels
    channels,
    channelFilter,
    setChannelFilter,
    isRefreshingChannels,
    refreshChannels,
    closeChannel,
    selectedChannelId,
    setSelectedChannelId,
    selectedChannel,
    selectedPending,
    selectedCanClose,
    selectedIsClosing,
    forceCloseConfirmOpen,
    setForceCloseConfirmOpen,
    channelCounts,
    visibleChannels,
    activeChannelCount,
    // payments
    invoiceInput,
    setInvoiceInput,
    createdInvoice,
    isCreatingInvoice,
    createInvoice,
    submitPayment,
    isPaying,
    paymentResult,
    // flow
    channelOpenFlow,
    openChannel,
    // notices
    latestError,
    statusNotice,
    // diagnostics aggregate
    refreshDiagnostics,
    // misc
    isNodeReady,
    connectorContext,
  };
}
