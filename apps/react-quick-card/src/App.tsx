import type { GetPaymentResult, HexString } from '@fiber-pay/sdk/browser';
import { ConnectButton, FiberPayQuickCard, useFiberNode } from '@fiber-pay/react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';

type ConnectStrategy = 'password' | 'passkey';

interface RuntimeSnapshot {
  nodeId: string;
  version: string;
  peers: number;
  channels: number;
}

interface EventLogEntry {
  id: string;
  text: string;
}

interface ExternalFundingSession {
  channelId: HexString;
  unsignedFundingTx: unknown;
}

interface ScriptLike {
  code_hash: HexString;
  hash_type: 'type' | 'data' | 'data1' | 'data2';
  args: HexString;
}

const SHANNONS_PER_CKB = 100_000_000n;
const SUGGESTED_FEE_BUFFER_SHANNONS = 100_000n; // 0.001 CKB

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

function ckbToShannons(amountCkb: string): bigint {
  const normalized = amountCkb.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Funding amount must be a valid CKB number.');
  }

  const [wholePart, fracPart = ''] = normalized.split('.');
  if (fracPart.length > 8 && /[1-9]/.test(fracPart.slice(8))) {
    throw new Error('Funding amount supports up to 8 decimal places.');
  }

  const fracPadded = `${fracPart}00000000`.slice(0, 8);
  const shannons = BigInt(wholePart) * SHANNONS_PER_CKB + BigInt(fracPadded || '0');

  if (shannons <= 0n) {
    throw new Error('Funding amount must be greater than 0.');
  }

  return shannons;
}

function ckbToShannonsHex(amountCkb: string): HexString {
  const shannons = ckbToShannons(amountCkb);
  return `0x${shannons.toString(16)}` as HexString;
}

function shannonsToCkb(shannons: bigint): string {
  const whole = shannons / SHANNONS_PER_CKB;
  const frac = shannons % SHANNONS_PER_CKB;
  if (frac === 0n) {
    return whole.toString();
  }

  return `${whole.toString()}.${frac.toString().padStart(8, '0').replace(/0+$/, '')}`;
}

function extractRequiredCapacityCkbFromError(message: string): string | null {
  const match = message.match(/value=([0-9]+(?:\.[0-9]+)?)/i);
  return match?.[1] ?? null;
}

function parseScriptJson(input: string, fallback: ScriptLike): ScriptLike {
  if (!input.trim()) {
    return fallback;
  }

  return JSON.parse(input) as ScriptLike;
}

function parseOptionalJson<T>(input: string): T | undefined {
  if (!input.trim()) {
    return undefined;
  }

  return JSON.parse(input) as T;
}

type ExternalWalletLike = {
  signTransaction?: (tx: unknown) => Promise<unknown>;
};

function resolveExternalSigner(): ((tx: unknown) => Promise<unknown>) | null {
  const candidates: Array<ExternalWalletLike | undefined> = [
    (globalThis as Record<string, unknown>).ckbExternalWallet as ExternalWalletLike | undefined,
    (globalThis as Record<string, unknown>).ckb as ExternalWalletLike | undefined,
  ];

  for (const wallet of candidates) {
    if (wallet?.signTransaction) {
      return wallet.signTransaction.bind(wallet);
    }
  }

  return null;
}

const sourceLinks = [
  {
    label: 'ConnectButton source',
    href: 'https://github.com/RetricSu/fiber-pay/blob/main/packages/react/src/connect-button.tsx',
  },
  {
    label: 'useFiberNode source',
    href: 'https://github.com/RetricSu/fiber-pay/blob/main/packages/react/src/use-fiber-node.ts',
  },
  {
    label: 'This demo page source',
    href: 'https://github.com/RetricSu/fiber-pay/blob/main/apps/react-quick-card/src/App.tsx',
  },
];

const themedConnectRootStyle = {
  '--fpay-accent': '#0f766e',
  '--fpay-accent-fg': '#ecfeff',
  '--fpay-accent-subtle': 'rgba(15,118,110,0.14)',
  '--fpay-accent-border': 'rgba(15,118,110,0.35)',
  '--fpay-border': '#99f6e4',
  '--fpay-bg-elevated': '#f0fdfa',
} as CSSProperties;

const themedDropdownStyle: CSSProperties = {
  width: 340,
  borderRadius: 12,
  border: '1px solid #5eead4',
};

export function App() {
  const [strategy, setStrategy] = useState<ConnectStrategy>('password');
  const [externalWallet, setExternalWallet] = useState(false);
  const [password, setPassword] = useState('demo-secret');
  const [eventLogs, setEventLogs] = useState<EventLogEntry[]>([]);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);
  const [externalFundingPeerPubkey, setExternalFundingPeerPubkey] = useState('');
  const [connectedPeerPubkeys, setConnectedPeerPubkeys] = useState<string[]>([]);
  const [peerAddressInput, setPeerAddressInput] = useState('');
  const [externalFundingAmountCkb, setExternalFundingAmountCkb] = useState('1000');
  const [shutdownScriptJson, setShutdownScriptJson] = useState('');
  const [fundingLockScriptJson, setFundingLockScriptJson] = useState('');
  const [fundingLockCellDepsJson, setFundingLockCellDepsJson] = useState('');
  const [unsignedFundingTxJson, setUnsignedFundingTxJson] = useState('');
  const [signedFundingTxJson, setSignedFundingTxJson] = useState('');
  const [externalFundingSession, setExternalFundingSession] = useState<ExternalFundingSession | null>(
    null,
  );
  const [fundingSubmitTxHash, setFundingSubmitTxHash] = useState<string | null>(null);
  const [externalFundingError, setExternalFundingError] = useState<string | null>(null);
  const [isOpeningExternalFunding, setIsOpeningExternalFunding] = useState(false);
  const [isSigningExternalFunding, setIsSigningExternalFunding] = useState(false);
  const [isSubmittingExternalFunding, setIsSubmittingExternalFunding] = useState(false);
  const [isRefreshingPeers, setIsRefreshingPeers] = useState(false);
  const [isConnectingPeer, setIsConnectingPeer] = useState(false);
  const [fundingAmountSuggestionCkb, setFundingAmountSuggestionCkb] = useState<string | null>(null);

  const fiber = useFiberNode({
    network: 'testnet',
    walletId: 'quick-card-connect-demo',
    externalWallet,
  });

  const addLog = (message: string) => {
    const now = new Date();
    const ts = now.toISOString().slice(11, 19);
    const entry = {
      id: `${now.getTime()}-${crypto.randomUUID()}`,
      text: `[${ts}] ${message}`,
    };
    setEventLogs((prev) => [entry, ...prev].slice(0, 20));
  };

  const clearLogs = () => {
    setEventLogs([]);
  };

  const normalizePubkey = (value: string): string =>
    value.trim().toLowerCase().replace(/^0x/, '');

  const refreshConnectedPeers = async () => {
    if (!fiber.node) {
      setConnectedPeerPubkeys([]);
      return;
    }

    setIsRefreshingPeers(true);
    try {
      const peers = await fiber.node.listPeers();
      const pubkeys = peers.peers.map((peer) => peer.pubkey);
      setConnectedPeerPubkeys(pubkeys);

      setExternalFundingPeerPubkey((prev) => {
        const normalizedPrev = normalizePubkey(prev);
        const hasPrev = pubkeys.some((item) => normalizePubkey(item) === normalizedPrev);
        if (hasPrev) {
          return prev;
        }
        return pubkeys[0] ?? prev;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExternalFundingError(message);
      addLog(`Refresh peers failed: ${message}`);
    } finally {
      setIsRefreshingPeers(false);
    }
  };

  const connectPeerByAddress = async () => {
    if (!fiber.node) {
      setExternalFundingError('Node is not connected.');
      return;
    }

    if (!peerAddressInput.trim()) {
      setExternalFundingError('Peer address is empty.');
      return;
    }

    setIsConnectingPeer(true);
    setExternalFundingError(null);

    try {
      await fiber.node.connectPeer({
        address: peerAddressInput.trim(),
        save: true,
      });
      addLog('Peer connected from address input.');
      await refreshConnectedPeers();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExternalFundingError(message);
      addLog(`Connect peer failed: ${message}`);
    } finally {
      setIsConnectingPeer(false);
    }
  };

  const applyExternalFundingDefaults = () => {
    if (!fiber.nodeInfo) {
      setExternalFundingError('Connect first so defaults can be loaded from node_info.');
      return;
    }

    const defaultPubkey = connectedPeerPubkeys[0] ?? '';
    const defaultScript = JSON.stringify(fiber.nodeInfo.default_funding_lock_script, null, 2);

    if (defaultPubkey) {
      setExternalFundingPeerPubkey(defaultPubkey);
    }
    setShutdownScriptJson(defaultScript);
    setFundingLockScriptJson(defaultScript);
    setExternalFundingError(null);
    addLog(
      defaultPubkey
        ? 'Applied defaults from node: connected peer pubkey + funding/shutdown scripts.'
        : 'Applied default scripts from node. Connect a peer to auto-fill target pubkey.',
    );
  };

  useEffect(() => {
    if (!externalWallet || !fiber.nodeInfo) {
      return;
    }

    const nodeInfo = fiber.nodeInfo;
    const defaultScript = JSON.stringify(nodeInfo.default_funding_lock_script, null, 2);

    setExternalFundingPeerPubkey((prev) => (prev.trim() ? prev : connectedPeerPubkeys[0] ?? prev));
    setShutdownScriptJson((prev) => (prev.trim() ? prev : defaultScript));
    setFundingLockScriptJson((prev) => (prev.trim() ? prev : defaultScript));
  }, [externalWallet, fiber.nodeInfo, connectedPeerPubkeys]);

  useEffect(() => {
    if (!externalWallet || !fiber.isRunning || !fiber.node) {
      setConnectedPeerPubkeys([]);
      return;
    }

    void refreshConnectedPeers();
  }, [externalWallet, fiber.isRunning, fiber.node]);

  const startExternalFunding = async () => {
    if (!fiber.node || !fiber.nodeInfo) {
      setExternalFundingError('Node is not connected.');
      return;
    }

    if (!externalWallet) {
      setExternalFundingError('Turn on External Wallet mode first.');
      return;
    }

    setIsOpeningExternalFunding(true);
    setExternalFundingError(null);
    setFundingSubmitTxHash(null);
    setFundingAmountSuggestionCkb(null);

    try {
      const targetPubkey = toHexPrefixed(externalFundingPeerPubkey);
      const normalizedTarget = normalizePubkey(targetPubkey);
      const isConnected = connectedPeerPubkeys.some(
        (peerPubkey) => normalizePubkey(peerPubkey) === normalizedTarget,
      );

      if (!isConnected) {
        throw new Error('Target peer is not connected. Connect/select a peer before opening funding.');
      }

      const fundingAmount = ckbToShannonsHex(externalFundingAmountCkb);
      const defaultScript = fiber.nodeInfo.default_funding_lock_script;

      const result = await fiber.node.openChannelWithExternalFunding({
        pubkey: targetPubkey,
        funding_amount: fundingAmount,
        shutdown_script: parseScriptJson(shutdownScriptJson, defaultScript),
        funding_lock_script: parseScriptJson(fundingLockScriptJson, defaultScript),
        funding_lock_script_cell_deps: parseOptionalJson(fundingLockCellDepsJson),
      });

      setExternalFundingSession({
        channelId: result.channel_id,
        unsignedFundingTx: result.unsigned_funding_tx,
      });

      const unsignedJson = JSON.stringify(result.unsigned_funding_tx, null, 2);
      setUnsignedFundingTxJson(unsignedJson);
      setSignedFundingTxJson('');

      addLog(`External funding request created for channel ${shorten(result.channel_id, 12, 8)}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const requiredCapacityCkb = extractRequiredCapacityCkbFromError(message);

      if (requiredCapacityCkb) {
        try {
          const enteredShannons = ckbToShannons(externalFundingAmountCkb);
          const requiredShannons = ckbToShannons(requiredCapacityCkb);

          if (requiredShannons > enteredShannons) {
            const shortfall = requiredShannons - enteredShannons;
            const suggestedShannons = enteredShannons - shortfall - SUGGESTED_FEE_BUFFER_SHANNONS;

            if (suggestedShannons > 0n) {
              const suggestedCkb = shannonsToCkb(suggestedShannons);
              setFundingAmountSuggestionCkb(suggestedCkb);
              setExternalFundingError(
                `容量不足：当前金额 ${externalFundingAmountCkb} CKB 不能覆盖手续费。建议改为 ${suggestedCkb} CKB（含 0.001 CKB 缓冲）。原始错误：${message}`,
              );
            } else {
              setExternalFundingError(
                `容量不足：当前余额无法覆盖该通道金额与手续费。请降低金额或给该 lock script 充值。原始错误：${message}`,
              );
            }
          } else {
            setExternalFundingError(message);
          }
        } catch {
          setExternalFundingError(message);
        }
      } else {
        setExternalFundingError(message);
      }

      addLog(`External funding open failed: ${message}`);
    } finally {
      setIsOpeningExternalFunding(false);
    }
  };

  const signWithExternalWallet = async () => {
    if (!unsignedFundingTxJson.trim()) {
      setExternalFundingError('No unsigned funding tx found. Start funding request first.');
      return;
    }

    setIsSigningExternalFunding(true);
    setExternalFundingError(null);

    try {
      const sign = resolveExternalSigner();
      if (!sign) {
        throw new Error(
          'No external wallet signer found on window. Provide signed tx manually below or expose window.ckbExternalWallet.signTransaction(tx).',
        );
      }

      const unsignedTx = JSON.parse(unsignedFundingTxJson) as unknown;
      const signedTx = await sign(unsignedTx);
      setSignedFundingTxJson(JSON.stringify(signedTx, null, 2));
      addLog('External wallet signing completed. Ready to submit signed funding tx.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExternalFundingError(message);
      addLog(`External wallet signing failed: ${message}`);
    } finally {
      setIsSigningExternalFunding(false);
    }
  };

  const submitSignedFunding = async () => {
    if (!fiber.node) {
      setExternalFundingError('Node is not connected.');
      return;
    }

    if (!externalFundingSession) {
      setExternalFundingError('No pending channel funding session. Start funding request first.');
      return;
    }

    if (!signedFundingTxJson.trim()) {
      setExternalFundingError('Signed funding tx is empty.');
      return;
    }

    setIsSubmittingExternalFunding(true);
    setExternalFundingError(null);

    try {
      const signedTx = JSON.parse(signedFundingTxJson) as unknown;
      const result = await fiber.node.submitSignedFundingTx({
        channel_id: externalFundingSession.channelId,
        signed_funding_tx: signedTx as Record<string, unknown>,
      });

      setFundingSubmitTxHash(result.funding_tx_hash);
      addLog(`Submitted signed funding tx: ${shorten(result.funding_tx_hash, 12, 8)}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExternalFundingError(message);
      addLog(`Submit signed funding tx failed: ${message}`);
    } finally {
      setIsSubmittingExternalFunding(false);
    }
  };

  const copyUnsignedFundingTx = async () => {
    if (!unsignedFundingTxJson.trim()) {
      setExternalFundingError('No unsigned funding tx to copy.');
      return;
    }

    try {
      await navigator.clipboard.writeText(unsignedFundingTxJson);
      setExternalFundingError(null);
      addLog('Unsigned funding tx copied to clipboard.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExternalFundingError(message);
      addLog(`Copy unsigned tx failed: ${message}`);
    }
  };

  const readRuntimeSnapshot = async () => {
    if (!fiber.node) {
      setSnapshotError('Node is not connected yet.');
      return;
    }

    setIsSnapshotLoading(true);
    setSnapshotError(null);
    try {
      const [info, peers, channels] = await Promise.all([
        fiber.node.nodeInfo(),
        fiber.node.listPeers(),
        fiber.node.listChannels(),
      ]);
      setSnapshot({
        nodeId: info.pubkey,
        version: info.version,
        peers: peers.peers?.length ?? 0,
        channels: channels.channels?.length ?? 0,
      });
      addLog('Runtime snapshot loaded (node_info/list_peers/list_channels).');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSnapshotError(message);
      addLog(`Snapshot error: ${message}`);
    } finally {
      setIsSnapshotLoading(false);
    }
  };

  const handleInvoiceCreated = (invoice: string) => {
    console.log('Invoice created:', invoice);
    addLog(`QuickCard invoice created: ${invoice.slice(0, 32)}...`);
  };

  const handlePaymentResult = (result: GetPaymentResult) => {
    console.log('Payment result:', result);
    addLog(`QuickCard payment status: ${result.status}`);
  };

  const handleError = (error: { scope: 'node' | 'payment' | 'invoice'; message: string }) => {
    console.error('FiberPay error:', error);
    addLog(`QuickCard error (${error.scope}): ${error.message}`);
  };

  const statusSummary = useMemo(
    () => [
      { label: 'State', value: fiber.state },
      { label: 'Connected', value: fiber.isRunning ? 'Yes' : 'No' },
      { label: 'Node', value: fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey) : 'Not connected' },
      {
        label: 'Passkey Support',
        value: fiber.isPasskeySupported ? 'Available' : fiber.passkeyUnavailableReason ?? 'Unavailable',
      },
      {
        label: 'Funding Mode',
        value: externalWallet ? 'External wallet (no local CKB key)' : 'Internal wallet (derived CKB key)',
      },
    ],
    [
      externalWallet,
      fiber.isPasskeySupported,
      fiber.isRunning,
      fiber.nodeInfo?.pubkey,
      fiber.passkeyUnavailableReason,
      fiber.state,
    ],
  );

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <h1>Fiber Pay React SDK Capability Demo</h1>
      <p>
        This page is designed as a downstream developer walkthrough. It shows what the React SDK gives
        you and how to verify each capability quickly.
      </p>
      <ol style={{ marginTop: 8, paddingLeft: 22 }}>
        <li>Connection lifecycle using <code>useFiberNode</code> + <code>ConnectButton</code>.</li>
        <li>Basic runtime RPC checks after connection.</li>
        <li>Fast payment UI integration using <code>FiberPayQuickCard</code>.</li>
      </ol>

      <div
        style={{
          marginTop: 12,
          border: '1px solid #d1d5db',
          borderRadius: 10,
          padding: 12,
          background: '#f8fafc',
        }}
      >
        <strong style={{ fontSize: 14 }}>Source code links</strong>
        <ul style={{ marginBottom: 0, marginTop: 8, paddingLeft: 18 }}>
          {sourceLinks.map((item) => (
            <li key={item.href}>
              <a href={item.href} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8' }}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <section
        style={{
          marginTop: 20,
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 16,
          background: '#fafafa',
        }}
      >
        <h2 style={{ marginTop: 0 }}>1) Connection + Lifecycle (Custom App Style)</h2>
        <p style={{ marginTop: 0 }}>
          Use one shared <code>useFiberNode</code> instance and drive connection with explicit strategy.
        </p>

        <p style={{ marginTop: -4, fontSize: 13, color: '#475569' }}>
          You can combine either strategy with internal or external wallet funding mode.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setStrategy('password')}
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 8,
              padding: '6px 10px',
              background: strategy === 'password' ? '#111827' : '#fff',
              color: strategy === 'password' ? '#fff' : '#111827',
              cursor: 'pointer',
            }}
          >
            Password Strategy
          </button>
          <button
            type="button"
            onClick={() => setStrategy('passkey')}
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 8,
              padding: '6px 10px',
              background: strategy === 'passkey' ? '#111827' : '#fff',
              color: strategy === 'passkey' ? '#fff' : '#111827',
              cursor: 'pointer',
            }}
          >
            Passkey Strategy
          </button>
          <button
            type="button"
            onClick={() => setExternalWallet((value) => !value)}
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 8,
              padding: '6px 10px',
              background: externalWallet ? '#0f766e' : '#fff',
              color: externalWallet ? '#fff' : '#111827',
              cursor: 'pointer',
            }}
          >
            {externalWallet ? 'External Wallet: ON' : 'External Wallet: OFF'}
          </button>
        </div>

        {strategy === 'password' && (
          <label style={{ display: 'block', fontSize: 13, marginBottom: 12 }}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ marginLeft: 8, padding: '6px 8px', borderRadius: 8, border: '1px solid #d1d5db' }}
            />
          </label>
        )}

        {strategy === 'passkey' && !fiber.isPasskeySupported && (
          <p style={{ marginTop: 0, color: '#b45309', fontSize: 13 }}>
            Passkey is currently unavailable: {fiber.passkeyUnavailableReason}
          </p>
        )}

        <ConnectButton
          fiber={fiber}
          strategy={strategy}
          externalWallet={externalWallet}
          password={strategy === 'password' ? password : undefined}
          onConnect={(_node, info) => {
            addLog(`ConnectButton connected: ${shorten(info.pubkey, 12, 10)}`);
          }}
          onDisconnect={() => {
            addLog('ConnectButton disconnected');
          }}
          onError={(msg) => {
            addLog(`ConnectButton error: ${msg}`);
          }}
        />

        <div
          style={{
            marginTop: 14,
            border: '1px dashed #cbd5e1',
            borderRadius: 10,
            padding: 12,
            background: '#fff',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 16 }}>UI Customization Showcase</h3>
          <p style={{ marginTop: 0, fontSize: 13, color: '#475569' }}>
            Same connection state, different UI surface. This mimics component-library style examples.
          </p>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Default appearance</div>
              <ConnectButton
                fiber={fiber}
                strategy={strategy}
                externalWallet={externalWallet}
                password={strategy === 'password' ? password : undefined}
              />
            </div>

            <div style={{ border: '1px solid #99f6e4', borderRadius: 10, padding: 10, background: '#f0fdfa' }}>
              <div style={{ fontSize: 12, color: '#0f766e', marginBottom: 8 }}>Themed + custom dropdown</div>
              <ConnectButton
                fiber={fiber}
                strategy={strategy}
                externalWallet={externalWallet}
                password={strategy === 'password' ? password : undefined}
                style={themedConnectRootStyle}
                dropdownStyle={themedDropdownStyle}
                renderConnectedDropdown={({ fiber: dropdownFiber, disconnect }) => (
                  <div>
                    <div style={{ fontSize: 12, color: '#0f766e', marginBottom: 6 }}>Custom connected panel</div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>
                      State: <strong>{dropdownFiber.state}</strong>
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 8 }}>
                      Pubkey: <strong>{shorten(dropdownFiber.nodeInfo?.pubkey ?? 'n/a', 8, 6)}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void disconnect();
                      }}
                      style={{
                        width: '100%',
                        borderRadius: 8,
                        border: '1px solid #0f766e',
                        background: '#14b8a6',
                        color: '#fff',
                        padding: '7px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      Disconnect (custom action)
                    </button>
                  </div>
                )}
              />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 13, display: 'grid', gap: 6 }}>
          {statusSummary.map((item) => (
            <div key={item.label}>
              {item.label}: <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        {externalWallet && (
          <div
            style={{
              marginTop: 12,
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              padding: 12,
              background: '#f8fafc',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 16 }}>
              External Wallet Funding Flow (Open + Sign + Submit)
            </h3>
            <p style={{ marginTop: 0, fontSize: 13, color: '#475569' }}>
              This is the missing end-to-end path for external wallet mode. Create an unsigned funding
              tx, ask external wallet to sign it, then submit the signed tx.
            </p>

            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 13 }}>
                Target Peer Pubkey (must be connected)
                <input
                  type="text"
                  list="connected-peer-pubkeys"
                  value={externalFundingPeerPubkey}
                  onChange={(e) => setExternalFundingPeerPubkey(e.target.value)}
                  placeholder={connectedPeerPubkeys[0] ?? '0x...'}
                  style={{ width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                />
                <datalist id="connected-peer-pubkeys">
                  {connectedPeerPubkeys.map((peerPubkey) => (
                    <option key={peerPubkey} value={peerPubkey} />
                  ))}
                </datalist>
                <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
                  Connected peers: {connectedPeerPubkeys.length}
                </div>
              </label>

              <label style={{ fontSize: 13 }}>
                Connect Peer by Address (optional, if no peers connected)
                <input
                  type="text"
                  value={peerAddressInput}
                  onChange={(e) => setPeerAddressInput(e.target.value)}
                  placeholder="/dns4/.../tcp/.../wss/p2p/..."
                  style={{ width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                />
              </label>

              <label style={{ fontSize: 13 }}>
                Funding Amount (CKB)
                <input
                  type="text"
                  value={externalFundingAmountCkb}
                  onChange={(e) => {
                    setExternalFundingAmountCkb(e.target.value);
                    setFundingAmountSuggestionCkb(null);
                  }}
                  placeholder="1000"
                  style={{ width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                />
              </label>

              {fundingAmountSuggestionCkb && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#0f766e',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span>Suggested amount: {fundingAmountSuggestionCkb} CKB</span>
                  <button
                    type="button"
                    onClick={() => {
                      setExternalFundingAmountCkb(fundingAmountSuggestionCkb);
                      setFundingAmountSuggestionCkb(null);
                      setExternalFundingError(null);
                    }}
                    style={{
                      border: '1px solid #0f766e',
                      borderRadius: 6,
                      padding: '3px 8px',
                      background: '#ecfdf5',
                      color: '#0f766e',
                      cursor: 'pointer',
                    }}
                  >
                    Use Suggested Amount
                  </button>
                </div>
              )}

              <label style={{ fontSize: 13 }}>
                Shutdown Script JSON (optional, defaults to node default script)
                <textarea
                  value={shutdownScriptJson}
                  onChange={(e) => setShutdownScriptJson(e.target.value)}
                  rows={4}
                  placeholder='{"code_hash":"0x...","hash_type":"type","args":"0x..."}'
                  style={{ width: '100%', marginTop: 4, padding: '8px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
                />
              </label>

              <label style={{ fontSize: 13 }}>
                Funding Lock Script JSON (optional, defaults to node default script)
                <textarea
                  value={fundingLockScriptJson}
                  onChange={(e) => setFundingLockScriptJson(e.target.value)}
                  rows={4}
                  placeholder='{"code_hash":"0x...","hash_type":"type","args":"0x..."}'
                  style={{ width: '100%', marginTop: 4, padding: '8px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
                />
              </label>

              <label style={{ fontSize: 13 }}>
                Funding Lock Script CellDeps JSON (optional)
                <textarea
                  value={fundingLockCellDepsJson}
                  onChange={(e) => setFundingLockCellDepsJson(e.target.value)}
                  rows={3}
                  placeholder='[{"out_point":{"tx_hash":"0x...","index":"0x0"},"dep_type":"code"}]'
                  style={{ width: '100%', marginTop: 4, padding: '8px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
                />
              </label>
            </div>

            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  void refreshConnectedPeers();
                }}
                disabled={!fiber.isRunning || isRefreshingPeers}
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 10px', background: '#fff', cursor: fiber.isRunning ? 'pointer' : 'not-allowed', opacity: fiber.isRunning ? 1 : 0.65 }}
              >
                {isRefreshingPeers ? 'Refreshing Peers...' : 'Refresh Connected Peers'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void connectPeerByAddress();
                }}
                disabled={!fiber.isRunning || isConnectingPeer}
                style={{ border: '1px solid #334155', borderRadius: 8, padding: '7px 10px', background: '#334155', color: '#fff', cursor: fiber.isRunning ? 'pointer' : 'not-allowed', opacity: fiber.isRunning ? 1 : 0.65 }}
              >
                {isConnectingPeer ? 'Connecting Peer...' : 'Connect Peer by Address'}
              </button>
              <button
                type="button"
                onClick={applyExternalFundingDefaults}
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 10px', background: '#fff', cursor: 'pointer' }}
              >
                Use Node Defaults (Pubkey + Scripts)
              </button>
              <button
                type="button"
                onClick={() => {
                  void startExternalFunding();
                }}
                disabled={!fiber.isRunning || isOpeningExternalFunding}
                style={{ border: '1px solid #0f766e', borderRadius: 8, padding: '7px 10px', background: '#14b8a6', color: '#fff', cursor: fiber.isRunning ? 'pointer' : 'not-allowed', opacity: fiber.isRunning ? 1 : 0.65 }}
              >
                {isOpeningExternalFunding ? 'Opening Funding...' : 'Open External Funding Request'}
              </button>
            </div>

            {externalFundingSession && (
              <p style={{ marginTop: 10, fontSize: 13 }}>
                Pending Channel ID: <strong>{externalFundingSession.channelId}</strong>
              </p>
            )}

            <label style={{ display: 'block', marginTop: 10, fontSize: 13 }}>
              Unsigned Funding Tx JSON
              <textarea
                value={unsignedFundingTxJson}
                onChange={(e) => setUnsignedFundingTxJson(e.target.value)}
                rows={6}
                style={{ width: '100%', marginTop: 4, padding: '8px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
              />
            </label>

            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  void copyUnsignedFundingTx();
                }}
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 10px', background: '#fff', cursor: 'pointer' }}
              >
                Copy Unsigned Tx
              </button>
              <button
                type="button"
                onClick={() => {
                  void signWithExternalWallet();
                }}
                disabled={isSigningExternalFunding}
                style={{ border: '1px solid #2563eb', borderRadius: 8, padding: '7px 10px', background: '#3b82f6', color: '#fff', cursor: 'pointer', opacity: isSigningExternalFunding ? 0.7 : 1 }}
              >
                {isSigningExternalFunding ? 'Signing...' : 'Sign with External Wallet'}
              </button>
            </div>

            <label style={{ display: 'block', marginTop: 10, fontSize: 13 }}>
              Signed Funding Tx JSON
              <textarea
                value={signedFundingTxJson}
                onChange={(e) => setSignedFundingTxJson(e.target.value)}
                rows={6}
                style={{ width: '100%', marginTop: 4, padding: '8px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
              />
            </label>

            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  void submitSignedFunding();
                }}
                disabled={!externalFundingSession || isSubmittingExternalFunding}
                style={{ border: '1px solid #0f766e', borderRadius: 8, padding: '7px 10px', background: '#0f766e', color: '#fff', cursor: externalFundingSession ? 'pointer' : 'not-allowed', opacity: externalFundingSession ? 1 : 0.65 }}
              >
                {isSubmittingExternalFunding ? 'Submitting...' : 'Submit Signed Funding Tx'}
              </button>
            </div>

            {fundingSubmitTxHash && (
              <p style={{ marginTop: 10, fontSize: 13 }}>
                Funding Tx Hash: <strong>{fundingSubmitTxHash}</strong>
              </p>
            )}

            {externalFundingError && (
              <p style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>{externalFundingError}</p>
            )}
          </div>
        )}

        {fiber.error && (
          <div
            style={{
              marginTop: 10,
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#991b1b',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 13,
            }}
          >
            Hook error: {fiber.error}
          </div>
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              void readRuntimeSnapshot();
            }}
            disabled={!fiber.isRunning || isSnapshotLoading}
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 8,
              padding: '7px 10px',
              background: '#fff',
              cursor: fiber.isRunning ? 'pointer' : 'not-allowed',
              opacity: fiber.isRunning ? 1 : 0.6,
            }}
          >
            {isSnapshotLoading ? 'Reading snapshot...' : 'Read runtime snapshot'}
          </button>
          <button
            type="button"
            onClick={clearLogs}
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 8,
              padding: '7px 10px',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Clear logs
          </button>
        </div>

        {snapshotError && (
          <p style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>Snapshot error: {snapshotError}</p>
        )}

        {snapshot && (
          <div
            style={{
              marginTop: 10,
              border: '1px solid #d1d5db',
              background: '#fff',
              borderRadius: 8,
              padding: 10,
              fontSize: 13,
              display: 'grid',
              gap: 4,
            }}
          >
            <div>
              Snapshot Node: <strong>{shorten(snapshot.nodeId)}</strong>
            </div>
            <div>
              Version: <strong>{snapshot.version}</strong>
            </div>
            <div>
              Peers: <strong>{snapshot.peers}</strong>
            </div>
            <div>
              Channels: <strong>{snapshot.channels}</strong>
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: 12,
            background: '#111827',
            color: '#e5e7eb',
            borderRadius: 8,
            padding: 10,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            minHeight: 110,
          }}
        >
          {eventLogs.length === 0
            ? 'No events yet.'
            : eventLogs.map((entry) => <div key={entry.id}>{entry.text}</div>)}
        </div>
      </section>

      <section
        style={{
          marginTop: 20,
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 16,
        }}
      >
        <h2 style={{ marginTop: 0 }}>2) Quick Payment UI (MVP Style)</h2>
        <p>
          <code>FiberPayQuickCard</code> is the fastest way to embed invoice creation + payment actions.
          This block is intentionally standalone and uses a separate <code>walletId</code>.
        </p>
        <FiberPayQuickCard
          network="testnet"
          walletId="quick-card-mvp-demo"
          title="Quick Card"
          onInvoiceCreated={handleInvoiceCreated}
          onPaymentResult={handlePaymentResult}
          onError={handleError}
        />
      </section>
    </div>
  );
}
