import type {
  AbandonChannelParams,
  Channel,
  GetPaymentResult,
  HexString,
  Script,
  ShutdownChannelParams,
  UdtAsset,
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
import {
  buildPanelAssetOptions,
  CKB_ASSET_KEY,
  getAssetKey,
  getChannelAssetKey,
  type PanelAssetOption,
  resolvePanelAsset,
  tryResolvePanelAsset,
} from './assets.js';
import { defaultFiberNodeButtonI18n } from './i18n.js';
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
  isAbandonableChannelState,
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

export interface PanelChannelAssetCount {
  key: string;
  label: string;
  count: number;
}

function getDefaultFundingAmountForAsset(
  key: string,
  initialAssetKey: string,
  initialFundingAmount: string | undefined,
  initialFundingAmountCkb: string | undefined,
): string {
  if (key === initialAssetKey || key === CKB_ASSET_KEY) {
    return initialFundingAmount ?? initialFundingAmountCkb ?? '1000';
  }
  return '';
}

function getDefaultInvoiceAmountForAsset(
  key: string,
  initialAssetKey: string,
  initialInvoiceAmount: string | undefined,
): string {
  if (key === initialAssetKey && initialInvoiceAmount !== undefined) {
    return initialInvoiceAmount;
  }
  return key === CKB_ASSET_KEY ? '1' : '';
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
  availableAssets: PanelAssetOption[];
  showAssetSelectors: boolean;
  openChannelAssetKey: string;
  selectOpenChannelAsset: (key: string) => void;
  openChannelCustomUdt: string;
  setOpenChannelCustomUdt: Dispatch<SetStateAction<string>>;
  openChannelAsset: UdtAsset | null;
  createInvoiceAssetKey: string;
  selectCreateInvoiceAsset: (key: string) => void;
  createInvoiceCustomUdt: string;
  setCreateInvoiceCustomUdt: Dispatch<SetStateAction<string>>;
  createInvoiceAsset: UdtAsset | null;
  paymentAssetKey: string;
  selectPaymentAsset: (key: string) => void;
  paymentCustomUdt: string;
  setPaymentCustomUdt: Dispatch<SetStateAction<string>>;
  paymentAsset: UdtAsset | null;
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
  channelAssetFilter: string;
  setChannelAssetFilter: Dispatch<SetStateAction<string>>;
  channelAssetCounts: PanelChannelAssetCount[];
  channelFilterCounts: PanelChannelCounts;
  getChannelAssetLabel: (channel: Channel) => string;
  getUdtAssetLabel: (script: Script | null | undefined) => string;
  isRefreshingChannels: boolean;
  refreshChannels: () => Promise<void>;
  closeChannel: (channelId: string, force?: boolean) => Promise<void>;
  selectedChannelId: string | null;
  setSelectedChannelId: Dispatch<SetStateAction<string | null>>;
  selectedChannel: Channel | null;
  selectedPending: boolean;
  selectedCanClose: boolean;
  selectedStale: boolean;
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
  const t = props.t ?? defaultFiberNodeButtonI18n;
  const requestedInitialAssetKey = getAssetKey(asset);
  const availableAssets = useMemo(
    () => buildPanelAssetOptions(fiber.nodeInfo?.udt_cfg_infos, asset),
    [asset, fiber.nodeInfo?.udt_cfg_infos],
  );
  const initialAssetKey = availableAssets.some((option) => option.key === requestedInitialAssetKey)
    ? requestedInitialAssetKey
    : CKB_ASSET_KEY;

  const [activeTab, setActiveTab] = useState<PanelTab>('workbench');

  const [peerPubkey, setPeerPubkey] = useState(initialPeerPubkey);
  const [peerAddress, setPeerAddress] = useState(initialPeerAddress);
  const [fundingAmount, setFundingAmount] = useState(
    initialFundingAmount ?? initialFundingAmountCkb ?? '1000',
  );
  const [invoiceAmount, setInvoiceAmount] = useState(
    initialInvoiceAmount ?? (initialAssetKey === CKB_ASSET_KEY ? '1' : ''),
  );
  const [openChannelAssetKey, setOpenChannelAssetKey] = useState(initialAssetKey);
  const [openChannelCustomUdt, setOpenChannelCustomUdt] = useState('');
  const [createInvoiceAssetKey, setCreateInvoiceAssetKey] = useState(initialAssetKey);
  const [createInvoiceCustomUdt, setCreateInvoiceCustomUdt] = useState('');
  const [paymentAssetKey, setPaymentAssetKey] = useState(initialAssetKey);
  const [paymentCustomUdt, setPaymentCustomUdt] = useState('');

  const [connectedPeers, setConnectedPeers] = useState<PeerInfo[]>([]);
  const [isRefreshingPeers, setIsRefreshingPeers] = useState(false);
  const [isConnectingPeer, setIsConnectingPeer] = useState(false);

  const [graphNodes, setGraphNodes] = useState<GraphNodeInfo[]>([]);
  const [graphChannels, setGraphChannels] = useState<GraphChannelInfo[]>([]);
  const [isRefreshingGraph, setIsRefreshingGraph] = useState(false);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('active');
  const [channelAssetFilter, setChannelAssetFilter] = useState('all');
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
  const previousAssetIdentityRef = useRef(initialAssetKey);
  const peerListId = useId();
  const tabPanelId = useId();

  const channelOpenFlow = useChannelOpenFlow({
    node: fiber.node,
    onLog,
  });

  const showAssetSelectors = availableAssets.some((option) => option.asset.kind === 'udt');

  const openChannelAssetResolution = useMemo(
    () => tryResolvePanelAsset(openChannelAssetKey, openChannelCustomUdt, availableAssets),
    [availableAssets, openChannelAssetKey, openChannelCustomUdt],
  );
  const openChannelAsset = openChannelAssetResolution.ok ? openChannelAssetResolution.asset : null;
  const createInvoiceAssetResolution = useMemo(
    () => tryResolvePanelAsset(createInvoiceAssetKey, createInvoiceCustomUdt, availableAssets),
    [availableAssets, createInvoiceAssetKey, createInvoiceCustomUdt],
  );
  const createInvoiceAsset = createInvoiceAssetResolution.ok
    ? createInvoiceAssetResolution.asset
    : null;
  const paymentAssetResolution = useMemo(
    () => tryResolvePanelAsset(paymentAssetKey, paymentCustomUdt, availableAssets),
    [availableAssets, paymentAssetKey, paymentCustomUdt],
  );
  const paymentAsset = paymentAssetResolution.ok ? paymentAssetResolution.asset : null;

  const paymentOptions = useMemo(
    () => ({ asset: paymentAsset ?? DEFAULT_CKB_ASSET, network }),
    [network, paymentAsset],
  );

  const {
    payInvoice,
    isPaying,
    paymentResult,
    error: paymentError,
  } = useFiberPayment(fiber.node, paymentOptions);

  const isNodeReady = fiber.isRunning && !!fiber.node && !!fiber.nodeInfo;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const selectOpenChannelAsset = useCallback(
    (key: string) => {
      setOpenChannelAssetKey(key);
      setFundingAmount(
        getDefaultFundingAmountForAsset(
          key,
          initialAssetKey,
          initialFundingAmount,
          initialFundingAmountCkb,
        ),
      );
      setLatestError(null);
    },
    [initialAssetKey, initialFundingAmount, initialFundingAmountCkb],
  );

  const selectCreateInvoiceAsset = useCallback(
    (key: string) => {
      setCreateInvoiceAssetKey(key);
      setInvoiceAmount(getDefaultInvoiceAmountForAsset(key, initialAssetKey, initialInvoiceAmount));
      setCreatedInvoice('');
      setLatestError(null);
    },
    [initialAssetKey, initialInvoiceAmount],
  );

  const selectPaymentAsset = useCallback((key: string) => {
    setPaymentAssetKey(key);
    setInvoiceInput('');
    setLatestError(null);
  }, []);

  useEffect(() => {
    const nextIdentity = initialAssetKey;
    if (previousAssetIdentityRef.current === nextIdentity) {
      return;
    }

    previousAssetIdentityRef.current = nextIdentity;
    setOpenChannelAssetKey(nextIdentity);
    setCreateInvoiceAssetKey(nextIdentity);
    setPaymentAssetKey(nextIdentity);
    setOpenChannelCustomUdt('');
    setCreateInvoiceCustomUdt('');
    setPaymentCustomUdt('');
    setFundingAmount(initialFundingAmount ?? initialFundingAmountCkb ?? '1000');
    setInvoiceAmount(initialInvoiceAmount ?? (initialAssetKey === CKB_ASSET_KEY ? '1' : ''));
    setInvoiceInput('');
    setCreatedInvoice('');
    setLatestError(null);
  }, [initialAssetKey, initialFundingAmount, initialFundingAmountCkb, initialInvoiceAmount]);

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

  const resolveActionAsset = useCallback(
    (key: string, customScript: string): UdtAsset | null => {
      try {
        return resolvePanelAsset(key, customScript, availableAssets);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reportError(
          t('asset.error.invalidSelection', 'Invalid asset selection: {message}', { message }),
        );
        return null;
      }
    },
    [availableAssets, reportError, t],
  );

  const ensureAssetConfigured = useCallback(
    (selectedAsset: UdtAsset) => {
      if (selectedAsset.kind !== 'udt') {
        return true;
      }

      let validatedScript: UdtTypeScript;
      try {
        validatedScript = validateUdtTypeScript(selectedAsset.script);
      } catch (error) {
        reportError(error instanceof Error ? error.message : String(error));
        return false;
      }

      const configuredUdts = fiber.nodeInfo?.udt_cfg_infos ?? [];

      if (
        configuredUdts.some((entry) => {
          try {
            const configuredScript = validateUdtTypeScript(entry.script, 'node UDT config');
            return areUdtTypeScriptsEqual(configuredScript, validatedScript);
          } catch {
            return false;
          }
        })
      ) {
        return true;
      }

      reportError(
        t(
          'asset.error.notConfigured',
          'UDT asset {asset} is not present in the node whitelist. Configure nodeConfig.udtWhitelist with the same type script and cell deps before using it.',
          { asset: selectedAsset.name?.trim() || t('asset.udt', 'UDT') },
        ),
      );
      return false;
    },
    [fiber.nodeInfo?.udt_cfg_infos, reportError, t],
  );

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

        // Stale channels are funded and awaiting the post-restore passive
        // audit; upstream `abandon_channel` does not protect Stale, so refuse
        // the close instead of destroying local state with funds inside.
        if (target.state.state_name === ChannelState.Stale) {
          setChannels(latest.channels);
          flashStatus('Channel is awaiting a post-restore audit and cannot be closed yet.', 'info');
          onLog?.(`Refused to close stale channel (audit pending): ${channelId}`);
          return;
        }

        if (isAbandonableChannelState(target.state.state_name)) {
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

    const selectedAsset = resolveActionAsset(openChannelAssetKey, openChannelCustomUdt);
    if (!selectedAsset || !ensureAssetConfigured(selectedAsset)) {
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
          asset: selectedAsset,
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
        asset: selectedAsset,
        fundingAmount,
        fundingAmountCkb: fundingAmount,
      });

      const openResult = await channelOpenFlow.openChannel({
        pubkey,
        fundingAmount,
        externalWallet: true,
        asset: selectedAsset,
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
    ensureAssetConfigured,
    fiber.node,
    flashStatus,
    fundingAmount,
    onLog,
    openChannelAssetKey,
    openChannelCustomUdt,
    peerPubkey,
    refreshChannels,
    reportError,
    resolveActionAsset,
  ]);

  const createInvoice = useCallback(async () => {
    if (!fiber.node) {
      reportError('Node is not connected.');
      return;
    }

    const selectedAsset = resolveActionAsset(createInvoiceAssetKey, createInvoiceCustomUdt);
    if (!selectedAsset || !ensureAssetConfigured(selectedAsset)) {
      return;
    }

    setIsCreatingInvoice(true);

    try {
      const amountInput = invoiceAmount.trim();
      const params = buildNewInvoiceParams({
        amountInput,
        asset: selectedAsset,
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
    createInvoiceAssetKey,
    createInvoiceCustomUdt,
    ensureAssetConfigured,
    fiber.node,
    flashStatus,
    invoiceAmount,
    network,
    onLog,
    reportError,
    resolveActionAsset,
  ]);

  const submitPayment = useCallback(async () => {
    const normalizedInvoice = invoiceInput.trim();
    if (!normalizedInvoice) {
      reportError('Invoice is empty.');
      return;
    }

    const selectedAsset = resolveActionAsset(paymentAssetKey, paymentCustomUdt);
    if (!selectedAsset || !ensureAssetConfigured(selectedAsset)) {
      return;
    }

    onLog?.('fiber_panel_primary_action_clicked: pay_invoice');
    await payInvoice(normalizedInvoice, { asset: selectedAsset, network });
  }, [
    ensureAssetConfigured,
    invoiceInput,
    network,
    onLog,
    payInvoice,
    paymentAssetKey,
    paymentCustomUdt,
    reportError,
    resolveActionAsset,
  ]);

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

  const assetLabelsByKey = useMemo(
    () => new Map(availableAssets.map((option) => [option.key, option.label])),
    [availableAssets],
  );

  const getUdtAssetLabel = useCallback(
    (script: Script | null | undefined) => {
      if (!script) {
        return 'CKB';
      }
      return assetLabelsByKey.get(getChannelAssetKey(script)) ?? 'UDT';
    },
    [assetLabelsByKey],
  );

  const getChannelAssetLabel = useCallback(
    (channel: Channel) => getUdtAssetLabel(channel.funding_udt_type_script),
    [getUdtAssetLabel],
  );

  const channelCounts = useMemo(() => {
    const counts = { active: 0, pending: 0, closed: 0, all: channels.length };

    for (const channel of channels) {
      counts[getChannelFilterState(channel)] += 1;
    }

    return counts;
  }, [channels]);

  const channelAssetCounts = useMemo(() => {
    const counts = new Map<string, PanelChannelAssetCount>();
    for (const channel of channels) {
      const key = getChannelAssetKey(channel.funding_udt_type_script);
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, {
          key,
          label: assetLabelsByKey.get(key) ?? (key === CKB_ASSET_KEY ? 'CKB' : 'UDT'),
          count: 1,
        });
      }
    }

    const assetOrder = new Map(availableAssets.map((option, index) => [option.key, index]));
    return Array.from(counts.values()).sort(
      (left, right) =>
        (assetOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
        (assetOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [assetLabelsByKey, availableAssets, channels]);

  useEffect(() => {
    if (
      channelAssetFilter !== 'all' &&
      !channelAssetCounts.some((entry) => entry.key === channelAssetFilter)
    ) {
      setChannelAssetFilter('all');
    }
  }, [channelAssetCounts, channelAssetFilter]);

  const channelsForAsset = useMemo(
    () =>
      channelAssetFilter === 'all'
        ? channels
        : channels.filter(
            (channel) => getChannelAssetKey(channel.funding_udt_type_script) === channelAssetFilter,
          ),
    [channelAssetFilter, channels],
  );

  const channelFilterCounts = useMemo(() => {
    const counts = { active: 0, pending: 0, closed: 0, all: channelsForAsset.length };
    for (const channel of channelsForAsset) {
      counts[getChannelFilterState(channel)] += 1;
    }
    return counts;
  }, [channelsForAsset]);

  const visibleChannels = useMemo(
    () =>
      channelFilter === 'all'
        ? channelsForAsset
        : channelsForAsset.filter((channel) => getChannelFilterState(channel) === channelFilter),
    [channelFilter, channelsForAsset],
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
    selectedState !== ChannelState.ShuttingDown &&
    // Stale: awaiting post-restore audit — neither shutdown nor abandon is safe.
    selectedState !== ChannelState.Stale;
  const selectedStale = selectedState === ChannelState.Stale;
  const selectedIsClosing = !!selectedChannel && closingChannelId === selectedChannel.channel_id;

  const connectorContext: FiberNodeButtonConnectorSectionContext = useMemo(
    () => ({
      fiber,
      asset: openChannelAsset ?? asset,
      externalFundingEnabled: !!externalFunding?.enabled,
      isOpeningChannel: channelOpenFlow.isOpening,
    }),
    [asset, channelOpenFlow.isOpening, externalFunding?.enabled, fiber, openChannelAsset],
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
    availableAssets,
    showAssetSelectors,
    openChannelAssetKey,
    selectOpenChannelAsset,
    openChannelCustomUdt,
    setOpenChannelCustomUdt,
    openChannelAsset,
    createInvoiceAssetKey,
    selectCreateInvoiceAsset,
    createInvoiceCustomUdt,
    setCreateInvoiceCustomUdt,
    createInvoiceAsset,
    paymentAssetKey,
    selectPaymentAsset,
    paymentCustomUdt,
    setPaymentCustomUdt,
    paymentAsset,
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
    channelAssetFilter,
    setChannelAssetFilter,
    channelAssetCounts,
    channelFilterCounts,
    getChannelAssetLabel,
    getUdtAssetLabel,
    isRefreshingChannels,
    refreshChannels,
    closeChannel,
    selectedChannelId,
    setSelectedChannelId,
    selectedChannel,
    selectedPending,
    selectedCanClose,
    selectedStale,
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
