import type {
  CellDep,
  FiberBrowserNode,
  FiberWasmFactory,
  HexString,
  NodeInfoResult,
  Script,
} from '@fiber-pay/sdk/browser';
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
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [isRefreshingPeers, setIsRefreshingPeers] = useState(false);
  const [isConnectingPeer, setIsConnectingPeer] = useState(false);

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
      const pubkeys = peers.peers.map((peer) => peer.pubkey);
      setConnectedPeers(pubkeys);
      setPeerPubkey((prev) => (prev.trim() ? prev : (pubkeys[0] ?? prev)));
      onLog?.(`Loaded connected peers: ${pubkeys.length}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(message);
      onLog?.(`Refresh peers failed: ${message}`);
    } finally {
      setIsRefreshingPeers(false);
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
      return;
    }

    void refreshConnectedPeers();
  }, [fiber.isRunning, fiber.node, refreshConnectedPeers]);

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
          <p style={styles.compactText}>State: {fiber.state}</p>
          <p style={styles.compactText}>
            Node: {fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey) : 'N/A'}
          </p>
          <p style={styles.compactText}>
            Funding mode: {externalFunding?.enabled ? 'External signer' : 'Internal node'}
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
        </section>

        <section style={styles.section}>
          <h4 style={styles.sectionTitle}>Channels</h4>
          <div style={styles.row}>
            <input
              style={styles.input}
              list={peerListId}
              value={peerPubkey}
              onChange={(event) => setPeerPubkey(event.target.value)}
              placeholder={connectedPeers[0] ?? 'Target peer pubkey (0x...)'}
            />
            <datalist id={peerListId}>
              {connectedPeers.map((peer) => (
                <option key={peer} value={peer} />
              ))}
            </datalist>
          </div>
          <div style={styles.row}>
            <input
              style={styles.input}
              value={peerAddress}
              onChange={(event) => setPeerAddress(event.target.value)}
              placeholder="Peer address (/dns4/.../wss/p2p/...)"
            />
          </div>
          <div style={styles.row}>
            <input
              style={styles.input}
              value={fundingAmountCkb}
              onChange={(event) => setFundingAmountCkb(event.target.value)}
              placeholder="Funding amount in CKB"
            />
          </div>
          <div style={{ ...styles.row, marginBottom: 0 }}>
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
              disabled={isConnectingPeer}
              onClick={() => {
                void connectPeerByAddress();
              }}
            >
              {isConnectingPeer ? 'Connecting...' : 'Connect Peer'}
            </button>
            <button
              type="button"
              style={styles.primaryButton}
              disabled={channelOpenFlow.isOpening}
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
        </section>

        <section style={styles.section}>
          <h4 style={styles.sectionTitle}>Payments</h4>
          <div style={styles.row}>
            <button
              type="button"
              style={styles.actionButton}
              disabled={isCreatingInvoice}
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
              disabled={isPaying}
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

        {renderConnectorSection ? (
          <section style={styles.section}>
            <h4 style={styles.sectionTitle}>Connector</h4>
            {renderConnectorSection(connectorContext)}
          </section>
        ) : null}

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
      connectPeerByAddress,
      connectorContext,
      createdInvoice,
      externalFunding?.enabled,
      fiber.nodeInfo?.pubkey,
      fiber.state,
      fundingAmountCkb,
      invoiceInput,
      isConnectingPeer,
      isCreatingInvoice,
      isPaying,
      isRefreshingPeers,
      mergedError,
      openChannel,
      paymentResult,
      peerAddress,
      peerListId,
      peerPubkey,
      refreshConnectedPeers,
      renderConnectorSection,
      submitPayment,
      createInvoice,
      connectedPeers,
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
