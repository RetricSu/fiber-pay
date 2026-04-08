import { useCallback, useEffect, useState } from 'react';
import type {
  Channel,
  FiberBrowserNode,
  GetInvoiceResult,
  GetPaymentResult,
  ListPeersResult,
  NodeInfoResult,
} from '@fiber-pay/sdk/browser';

type ActivityLevel = 'info' | 'success' | 'error';

interface ActivityLogItem {
  id: string;
  level: ActivityLevel;
  timestamp: string;
  message: string;
  detail?: string;
}

interface LatestInvoiceSnapshot {
  invoiceAddress: string;
  paymentHash: string;
  status: string;
}

type LoadingMap = Record<string, boolean>;

function operationErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function timeNow(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function toHex(value: number | bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}

function ckbToShannons(ckb: number | string): `0x${string}` {
  const amount = typeof ckb === 'string' ? Number.parseFloat(ckb) : ckb;
  const shannons = BigInt(Math.floor(amount * 1e8));
  return toHex(shannons);
}

function normalizePaymentHash(input: string): `0x${string}` {
  const normalized = input.trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(normalized)) {
    throw new Error('Payment hash must be a valid hex string starting with 0x.');
  }
  return normalized as `0x${string}`;
}

function validateBrowserPeerAddress(address: string): string | null {
  const hasWs = /\/ws(?:\/|$)/.test(address);
  const hasWss = /\/wss(?:\/|$)/.test(address);

  if (!hasWs && !hasWss) {
    return (
      'Browser WASM node cannot dial raw tcp multiaddr. Please use WebSocket multiaddr ' +
      '(suffix /ws or /wss), e.g. /dns4/<host>/tcp/443/wss/p2p/<peerId>.'
    );
  }

  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && hasWs && !hasWss) {
    return 'Current page is HTTPS; peer address must use /wss (secure websocket), not /ws.';
  }

  return null;
}

export function useFiberConsole(
  node: FiberBrowserNode | null,
  isRunning: boolean,
  network: 'testnet' | 'mainnet',
) {
  const [nodeInfo, setNodeInfo] = useState<NodeInfoResult | null>(null);
  const [peers, setPeers] = useState<ListPeersResult['peers']>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [graphNodeCount, setGraphNodeCount] = useState(0);
  const [graphChannelCount, setGraphChannelCount] = useState(0);

  const [latestInvoice, setLatestInvoice] = useState<LatestInvoiceSnapshot | null>(null);
  const [invoiceLookup, setInvoiceLookup] = useState<GetInvoiceResult | null>(null);
  const [latestPayment, setLatestPayment] = useState<GetPaymentResult | null>(null);
  const [paymentLookup, setPaymentLookup] = useState<GetPaymentResult | null>(null);

  const [loading, setLoading] = useState<LoadingMap>({});
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityLogItem[]>([]);

  const pushActivity = useCallback((level: ActivityLevel, message: string, detail?: string) => {
    const item: ActivityLogItem = {
      id: crypto.randomUUID(),
      level,
      timestamp: timeNow(),
      message,
      detail,
    };

    setActivity((prev) => {
      const next = [item, ...prev];
      if (next.length > 60) {
        return next.slice(0, 60);
      }
      return next;
    });
  }, []);

  const ensureNode = useCallback(() => {
    if (!node || !isRunning || !node.isRunning) {
      throw new Error('Node is not running. Start node first.');
    }
    return node;
  }, [isRunning, node]);

  const runAction = useCallback(
    async <T,>(name: string, action: () => Promise<T>): Promise<T | null> => {
      setLoading((prev) => ({ ...prev, [name]: true }));
      setError(null);

      try {
        return await action();
      } catch (actionError) {
        const message = operationErrorMessage(actionError);
        setError(message);
        pushActivity('error', `${name} failed`, message);
        return null;
      } finally {
        setLoading((prev) => ({ ...prev, [name]: false }));
      }
    },
    [pushActivity],
  );

  const refreshSnapshot = useCallback(async (): Promise<boolean> => {
    const result = await runAction('refreshSnapshot', async () => {
      const currentNode = ensureNode();
      const [info, peersResult, channelsResult] = await Promise.all([
        currentNode.getNodeInfo(),
        currentNode.listPeers(),
        currentNode.listChannels({ include_closed: true }),
      ]);

      setNodeInfo(info);
      setPeers(peersResult.peers);
      setChannels(channelsResult.channels);

      pushActivity(
        'success',
        `Snapshot refreshed: ${peersResult.peers.length} peers, ${channelsResult.channels.length} channels`,
      );
    });

    return result !== null;
  }, [ensureNode, pushActivity, runAction]);

  const refreshGraph = useCallback(async (): Promise<boolean> => {
    const result = await runAction('refreshGraph', async () => {
      const currentNode = ensureNode();
      const [nodesResult, channelsResult] = await Promise.all([
        currentNode.graphNodes({ limit: toHex(128) }),
        currentNode.graphChannels({ limit: toHex(128) }),
      ]);

      setGraphNodeCount(nodesResult.nodes.length);
      setGraphChannelCount(channelsResult.channels.length);

      pushActivity(
        'success',
        `Graph refreshed: ${nodesResult.nodes.length} nodes, ${channelsResult.channels.length} channels`,
      );
    });

    return result !== null;
  }, [ensureNode, pushActivity, runAction]);

  const connectPeer = useCallback(
    async (address: string): Promise<boolean> => {
      const normalizedAddress = address.trim();
      if (!normalizedAddress) {
        setError('Peer address is required.');
        return false;
      }

      const invalidReason = validateBrowserPeerAddress(normalizedAddress);
      if (invalidReason) {
        setError(invalidReason);
        pushActivity('error', 'connectPeer blocked', invalidReason);
        return false;
      }

      if (/\/ip4\//.test(normalizedAddress) && /\/wss(?:\/|$)/.test(normalizedAddress)) {
        pushActivity(
          'info',
          'Connecting to WSS over IP',
          'If TLS certificate does not include IP SAN, handshake may fail. Prefer /dns4/.../wss peer address.',
        );
      }

      const result = await runAction('connectPeer', async () => {
        const currentNode = ensureNode();
        await currentNode.connectPeer({ address: normalizedAddress, save: true });
        const peersResult = await currentNode.listPeers();
        setPeers(peersResult.peers);
        pushActivity('success', `Connected peer: ${normalizedAddress}`);
      });

      return result !== null;
    },
    [ensureNode, pushActivity, runAction],
  );

  const disconnectPeer = useCallback(
    async (peerId: string): Promise<boolean> => {
      const normalizedPeerId = peerId.trim();
      if (!normalizedPeerId) {
        setError('Peer ID is required.');
        return false;
      }

      const result = await runAction('disconnectPeer', async () => {
        const currentNode = ensureNode();
        await currentNode.disconnectPeer({ peer_id: normalizedPeerId });
        const peersResult = await currentNode.listPeers();
        setPeers(peersResult.peers);
        pushActivity('success', `Disconnected peer: ${normalizedPeerId}`);
      });

      return result !== null;
    },
    [ensureNode, pushActivity, runAction],
  );

  const openChannel = useCallback(
    async (peerId: string, fundingCkb: string): Promise<boolean> => {
      const normalizedPeerId = peerId.trim();
      const amount = Number.parseFloat(fundingCkb);

      if (!normalizedPeerId) {
        setError('Peer ID is required for opening a channel.');
        return false;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Funding amount must be a positive number.');
        return false;
      }

      const result = await runAction('openChannel', async () => {
        const currentNode = ensureNode();
        const openResult = await currentNode.openChannel({
          peer_id: normalizedPeerId,
          funding_amount: ckbToShannons(amount),
        });

        const channelsResult = await currentNode.listChannels({ include_closed: true });
        setChannels(channelsResult.channels);

        pushActivity(
          'success',
          `Channel opened with ${normalizedPeerId} (${fundingCkb} CKB)`,
          `Temporary channel ID: ${openResult.temporary_channel_id}`,
        );
      });

      return result !== null;
    },
    [ensureNode, pushActivity, runAction],
  );

  const closeChannel = useCallback(
    async (channelId: string, force = false): Promise<boolean> => {
      const normalizedChannelId = channelId.trim();
      if (!normalizedChannelId) {
        setError('Channel ID is required for closing channel.');
        return false;
      }

      const result = await runAction('closeChannel', async () => {
        const currentNode = ensureNode();
        const channelsResult = await currentNode.listChannels({ include_closed: true });
        const target = channelsResult.channels.find((channel) => channel.channel_id === normalizedChannelId);

        if (!target) {
          throw new Error(
            `Channel not found in latest snapshot: ${normalizedChannelId}. Try refreshing channels first.`,
          );
        }

        const stateName = target.state.state_name;

        // Pending channels are usually removed via abandon_channel, while ready channels should use shutdown_channel.
        if (stateName === 'CLOSED') {
          pushActivity('info', 'Channel is already closed', `Channel ID: ${normalizedChannelId}`);
          setChannels(channelsResult.channels);
          return;
        }

        if (
          stateName === 'NEGOTIATING_FUNDING' ||
          stateName === 'COLLABORATING_FUNDING_TX' ||
          stateName === 'SIGNING_COMMITMENT' ||
          stateName === 'AWAITING_TX_SIGNATURES' ||
          stateName === 'AWAITING_CHANNEL_READY'
        ) {
          await currentNode.abandonChannel({ channel_id: normalizedChannelId as `0x${string}` });
          pushActivity(
            'success',
            'Pending channel abandoned',
            `Channel ID: ${normalizedChannelId} (${stateName})`,
          );
        } else {
          await currentNode.shutdownChannel({
            channel_id: normalizedChannelId as `0x${string}`,
            force,
          });
          pushActivity(
            'success',
            `${force ? 'Force close' : 'Close'} channel requested`,
            `Channel ID: ${normalizedChannelId} (${stateName})`,
          );
        }

        const updatedChannelsResult = await currentNode.listChannels({ include_closed: true });
        setChannels(updatedChannelsResult.channels);
      });

      return result !== null;
    },
    [ensureNode, pushActivity, runAction],
  );

  const createInvoice = useCallback(
    async (amountCkb: string, description: string, expirySeconds: string): Promise<boolean> => {
      const amount = Number.parseFloat(amountCkb);
      const expiry = Number.parseInt(expirySeconds, 10);

      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Invoice amount must be a positive number.');
        return false;
      }
      if (!Number.isInteger(expiry) || expiry <= 0) {
        setError('Invoice expiry must be a positive integer (seconds).');
        return false;
      }

      const result = await runAction('createInvoice', async () => {
        const currentNode = ensureNode();
        const invoiceResult = await currentNode.newInvoice({
          amount: ckbToShannons(amount),
          currency: network === 'mainnet' ? 'Fibb' : 'Fibt',
          description: description.trim() || undefined,
          expiry: toHex(expiry),
        });

        const paymentHash = invoiceResult.invoice.data.payment_hash;
        setLatestInvoice({
          invoiceAddress: invoiceResult.invoice_address,
          paymentHash,
          status: 'Open',
        });

        pushActivity(
          'success',
          `Invoice created: ${amountCkb} CKB`,
          `Payment hash: ${paymentHash}`,
        );
      });

      return result !== null;
    },
    [ensureNode, network, pushActivity, runAction],
  );

  const queryInvoice = useCallback(
    async (paymentHash: string): Promise<boolean> => {
      let normalizedHash: `0x${string}`;
      try {
        normalizedHash = normalizePaymentHash(paymentHash);
      } catch (parseError) {
        setError(operationErrorMessage(parseError));
        return false;
      }

      if (!normalizedHash) {
        setError('Payment hash is required for invoice query.');
        return false;
      }

      const result = await runAction('queryInvoice', async () => {
        const currentNode = ensureNode();
        const invoiceResult = await currentNode.getInvoice({ payment_hash: normalizedHash });
        setInvoiceLookup(invoiceResult);
        setLatestInvoice({
          invoiceAddress: invoiceResult.invoice_address,
          paymentHash: normalizedHash,
          status: invoiceResult.status,
        });
        pushActivity('info', `Invoice queried: ${normalizedHash}`, `Status: ${invoiceResult.status}`);
      });

      return result !== null;
    },
    [ensureNode, pushActivity, runAction],
  );

  const cancelInvoice = useCallback(
    async (paymentHash: string): Promise<boolean> => {
      let normalizedHash: `0x${string}`;
      try {
        normalizedHash = normalizePaymentHash(paymentHash);
      } catch (parseError) {
        setError(operationErrorMessage(parseError));
        return false;
      }

      if (!normalizedHash) {
        setError('Payment hash is required for cancelling invoice.');
        return false;
      }

      const result = await runAction('cancelInvoice', async () => {
        const currentNode = ensureNode();
        const cancelled = await currentNode.cancelInvoice({ payment_hash: normalizedHash });
        const snapshot: GetInvoiceResult = {
          invoice_address: cancelled.invoice_address,
          invoice: cancelled.invoice,
          status: cancelled.status,
        };
        setInvoiceLookup(snapshot);
        setLatestInvoice({
          invoiceAddress: cancelled.invoice_address,
          paymentHash: normalizedHash,
          status: cancelled.status,
        });

        pushActivity('success', `Invoice cancelled: ${normalizedHash}`);
      });

      return result !== null;
    },
    [ensureNode, pushActivity, runAction],
  );

  const payInvoice = useCallback(
    async (invoiceAddress: string): Promise<boolean> => {
      const normalizedInvoice = invoiceAddress.trim();
      if (!normalizedInvoice) {
        setError('Invoice string is required.');
        return false;
      }

      const result = await runAction('payInvoice', async () => {
        const currentNode = ensureNode();

        const parsed = await currentNode.parseInvoice({ invoice: normalizedInvoice });
        const paymentHash = parsed.invoice.data.payment_hash;

        await currentNode.sendPayment({ invoice: normalizedInvoice });
        const finalPayment = await currentNode.waitForPayment(paymentHash);

        setLatestPayment(finalPayment);
        setPaymentLookup(finalPayment);

        if (finalPayment.status === 'Failed') {
          const reason = finalPayment.failed_error ?? 'Payment failed';
          throw new Error(reason);
        }

        pushActivity(
          'success',
          `Payment success: ${paymentHash}`,
          `Fee: ${finalPayment.fee} (hex shannons)`,
        );
      });

      return result !== null;
    },
    [ensureNode, pushActivity, runAction],
  );

  const queryPayment = useCallback(
    async (paymentHash: string): Promise<boolean> => {
      let normalizedHash: `0x${string}`;
      try {
        normalizedHash = normalizePaymentHash(paymentHash);
      } catch (parseError) {
        setError(operationErrorMessage(parseError));
        return false;
      }

      if (!normalizedHash) {
        setError('Payment hash is required for payment query.');
        return false;
      }

      const result = await runAction('queryPayment', async () => {
        const currentNode = ensureNode();
        const payment = await currentNode.getPayment({ payment_hash: normalizedHash });
        setPaymentLookup(payment);
        setLatestPayment(payment);
        pushActivity('info', `Payment queried: ${normalizedHash}`, `Status: ${payment.status}`);
      });

      return result !== null;
    },
    [ensureNode, pushActivity, runAction],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    if (!isRunning) {
      setNodeInfo(null);
      setPeers([]);
      setChannels([]);
      setGraphNodeCount(0);
      setGraphChannelCount(0);
      setLatestInvoice(null);
      setInvoiceLookup(null);
      setLatestPayment(null);
      setPaymentLookup(null);
      return;
    }

    void refreshSnapshot();
    void refreshGraph();
  }, [isRunning, refreshGraph, refreshSnapshot]);

  return {
    nodeInfo,
    peers,
    channels,
    graphNodeCount,
    graphChannelCount,
    latestInvoice,
    invoiceLookup,
    latestPayment,
    paymentLookup,
    loading,
    error,
    activity,
    clearError,
    refreshSnapshot,
    refreshGraph,
    connectPeer,
    disconnectPeer,
    openChannel,
    closeChannel,
    createInvoice,
    queryInvoice,
    cancelInvoice,
    payInvoice,
    queryPayment,
  };
}
