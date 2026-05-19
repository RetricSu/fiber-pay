import {
  type GetPaymentResult,
  type HexString,
} from '@fiber-pay/sdk/browser';
import { ccc } from '@ckb-ccc/connector-react';
import { ConnectButton, FiberPayQuickCard, useChannelOpenFlow, useFiberNode } from '@fiber-pay/react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { ExternalFundingDebugControls } from './components/external-funding-debug-controls';
import { useExternalFundingDebugFlow } from './hooks/use-external-funding-debug-flow';

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

interface CellDepLike {
  out_point: {
    tx_hash: HexString;
    index: HexString;
  };
  dep_type: 'code' | 'dep_group';
}

const TESTNET_CKB_RPC_URL = 'https://testnet.ckbapp.dev/';

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

function cccScriptToFiberScript(script: {
  codeHash: string;
  hashType: 'type' | 'data' | 'data1' | 'data2';
  args: string;
}): ScriptLike {
  return {
    code_hash: toHexPrefixed(script.codeHash),
    hash_type: script.hashType,
    args: toHexPrefixed(script.args),
  };
}

function cccOutPointIndexToHex(index: unknown): HexString {
  const bigintValue = typeof index === 'bigint' ? index : BigInt(String(index));
  return `0x${bigintValue.toString(16)}` as HexString;
}

function cccCellDepToFiberCellDep(dep: {
  outPoint: {
    txHash: string;
    index: unknown;
  };
  depType: 'code' | 'depGroup';
}): CellDepLike {
  return {
    out_point: {
      tx_hash: toHexPrefixed(dep.outPoint.txHash),
      index: cccOutPointIndexToHex(dep.outPoint.index),
    },
    dep_type: dep.depType === 'depGroup' ? 'dep_group' : 'code',
  };
}

async function resolveFundingLockCellDepsByKnownScript(
  signer: ccc.Signer,
  script: ScriptLike,
): Promise<{ knownScript: string; cellDeps: CellDepLike[] } | null> {
  const scriptCodeHash = script.code_hash.toLowerCase();
  const scriptHashType = script.hash_type;

  for (const knownScript of Object.values(ccc.KnownScript)) {
    try {
      const scriptInfo = await signer.client.getKnownScript(knownScript);
      if (
        scriptInfo.codeHash.toLowerCase() !== scriptCodeHash ||
        scriptInfo.hashType !== scriptHashType
      ) {
        continue;
      }

      const cellDeps = scriptInfo.cellDeps.map((depInfo) => cccCellDepToFiberCellDep(depInfo.cellDep));
      return {
        knownScript,
        cellDeps,
      };
    } catch {
      // Ignore unresolved scripts and continue matching by code hash/hash type.
    }
  }

  return null;
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
  const {
    open: openExternalWalletConnectModal,
    wallet: connectedExternalWallet,
    disconnect: disconnectExternalWallet,
  } = ccc.useCcc();
  const cccSigner = ccc.useSigner();

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
  const [externalFundingDiagnostic, setExternalFundingDiagnostic] = useState<string | null>(null);
  const [isRefreshingPeers, setIsRefreshingPeers] = useState(false);
  const [isConnectingPeer, setIsConnectingPeer] = useState(false);
  const [fundingAmountSuggestionCkb, setFundingAmountSuggestionCkb] = useState<string | null>(null);
  const [externalWalletAddress, setExternalWalletAddress] = useState<string | null>(null);
  const [isSyncingExternalWalletScript, setIsSyncingExternalWalletScript] = useState(false);

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

  const channelOpenFlow = useChannelOpenFlow({
    node: fiber.node,
    onLog: addLog,
  });

  const isOpeningExternalFunding = channelOpenFlow.isOpening;

  useEffect(() => {
    if (channelOpenFlow.error) {
      setExternalFundingError(channelOpenFlow.error);
    }
  }, [channelOpenFlow.error]);

  useEffect(() => {
    if (channelOpenFlow.diagnostic) {
      setExternalFundingDiagnostic(channelOpenFlow.diagnostic);
    }
  }, [channelOpenFlow.diagnostic]);

  useEffect(() => {
    if (channelOpenFlow.suggestedFundingAmountCkb) {
      setFundingAmountSuggestionCkb(channelOpenFlow.suggestedFundingAmountCkb);
    }
  }, [channelOpenFlow.suggestedFundingAmountCkb]);

  const externalFundingDebugFlow = useExternalFundingDebugFlow({
    node: fiber.node,
    cccSigner,
    resolveExternalSigner,
    externalFundingSession,
    externalFundingPeerPubkey,
    unsignedFundingTxJson,
    signedFundingTxJson,
    setSignedFundingTxJson,
    setExternalFundingError,
    setExternalFundingDiagnostic,
    setFundingSubmitTxHash,
    addLog,
  });

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

  const syncFundingScriptsFromConnectedExternalWallet = async (overwrite: boolean) => {
    if (!cccSigner) {
      throw new Error('Connect external wallet first via CCC connector.');
    }

    const addressObj = await cccSigner.getRecommendedAddressObj();
    const walletScript = cccScriptToFiberScript(addressObj.script);
    const scriptJson = JSON.stringify(walletScript, null, 2);
    const resolvedDeps = await resolveFundingLockCellDepsByKnownScript(cccSigner, walletScript);

    setExternalWalletAddress(addressObj.toString());
    setShutdownScriptJson((prev) => (overwrite || !prev.trim() ? scriptJson : prev));
    setFundingLockScriptJson((prev) => (overwrite || !prev.trim() ? scriptJson : prev));
    if (resolvedDeps) {
      const depsJson = JSON.stringify(resolvedDeps.cellDeps, null, 2);
      setFundingLockCellDepsJson((prev) => (overwrite || !prev.trim() ? depsJson : prev));
      addLog(`Resolved funding lock deps from CCC known script: ${resolvedDeps.knownScript}.`);
    } else if (overwrite) {
      setFundingLockCellDepsJson('');
      addLog('CCC could not match known script deps for this wallet lock script.');
    }
    setExternalFundingError(null);

    addLog(`Loaded funding script from CCC wallet address ${shorten(addressObj.toString(), 18, 10)}.`);
  };

  const applyExternalFundingDefaults = async () => {
    if (!fiber.nodeInfo) {
      setExternalFundingError('Connect first so defaults can be loaded from node_info.');
      return;
    }

    const defaultPubkey = connectedPeerPubkeys[0] ?? '';

    if (defaultPubkey) {
      setExternalFundingPeerPubkey(defaultPubkey);
    }

    if (externalWallet) {
      setIsSyncingExternalWalletScript(true);
      try {
        await syncFundingScriptsFromConnectedExternalWallet(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setExternalFundingError(message);
        addLog(`External wallet defaults failed: ${message}`);
      } finally {
        setIsSyncingExternalWalletScript(false);
      }
      return;
    }

    const defaultScript = JSON.stringify(fiber.nodeInfo.default_funding_lock_script, null, 2);
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
    if (!externalWallet) {
      return;
    }

    setExternalFundingPeerPubkey((prev) => (prev.trim() ? prev : connectedPeerPubkeys[0] ?? prev));
  }, [externalWallet, connectedPeerPubkeys]);

  useEffect(() => {
    if (!externalWallet || !cccSigner) {
      if (!externalWallet) {
        setExternalWalletAddress(null);
      }
      return;
    }

    let cancelled = false;
    const shouldAutofill = !shutdownScriptJson.trim() && !fundingLockScriptJson.trim();

    const load = async () => {
      try {
        const addressObj = await cccSigner.getRecommendedAddressObj();
        if (cancelled) {
          return;
        }

        setExternalWalletAddress(addressObj.toString());

        if (shouldAutofill) {
          const walletScript = cccScriptToFiberScript(addressObj.script);
          const scriptJson = JSON.stringify(walletScript, null, 2);
          setShutdownScriptJson(scriptJson);
          setFundingLockScriptJson(scriptJson);
          addLog('Auto-filled funding/shutdown scripts from connected CCC wallet.');
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setExternalFundingError(message);
        addLog(`Read CCC wallet script failed: ${message}`);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [cccSigner, externalWallet, fundingLockScriptJson, shutdownScriptJson]);

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

    if (!externalFundingPeerPubkey.trim()) {
      setExternalFundingError('Target peer pubkey is empty. Select or input a connected peer first.');
      return;
    }

    setExternalFundingError(null);
    setExternalFundingDiagnostic(null);
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

      const defaultScript = fiber.nodeInfo.default_funding_lock_script;
      const shutdownScript = parseScriptJson(shutdownScriptJson, defaultScript);
      const fundingLockScript = parseScriptJson(fundingLockScriptJson, defaultScript);
      let fundingLockScriptCellDeps = parseOptionalJson<CellDepLike[]>(fundingLockCellDepsJson);

      if (externalWallet && cccSigner && (!fundingLockScriptCellDeps || fundingLockScriptCellDeps.length === 0)) {
        const resolvedDeps = await resolveFundingLockCellDepsByKnownScript(cccSigner, fundingLockScript);
        if (resolvedDeps) {
          fundingLockScriptCellDeps = resolvedDeps.cellDeps;
          setFundingLockCellDepsJson(JSON.stringify(resolvedDeps.cellDeps, null, 2));
          addLog(`Injected funding lock deps from CCC known script: ${resolvedDeps.knownScript}.`);
        }
      }

      const signFundingTx = async (txForSigner: unknown): Promise<unknown> => {
        if (cccSigner) {
          const cccSignedTx = await cccSigner.signTransaction(txForSigner as ccc.TransactionLike);
          return JSON.parse(JSON.stringify(cccSignedTx)) as unknown;
        }

        const sign = resolveExternalSigner();
        if (!sign) {
          throw new Error('No external wallet signer found. Connect wallet via CCC first.');
        }

        return sign(txForSigner);
      };

      const result = await channelOpenFlow.openChannel({
        pubkey: targetPubkey,
        fundingAmountCkb: externalFundingAmountCkb,
        externalWallet,
        shutdownScript,
        fundingLockScript,
        fundingLockScriptCellDeps,
        signFundingTx,
        ckbRpcUrl: TESTNET_CKB_RPC_URL,
      });

      if (!result) {
        return;
      }

      setExternalFundingSession({
        channelId: result.channelId,
        unsignedFundingTx: result.unsignedFundingTx ?? null,
      });

      if (result.unsignedFundingTx) {
        setUnsignedFundingTxJson(JSON.stringify(result.unsignedFundingTx, null, 2));
      } else {
        setUnsignedFundingTxJson('');
      }

      if (result.signedFundingTx) {
        setSignedFundingTxJson(JSON.stringify(result.signedFundingTx, null, 2));
      } else {
        setSignedFundingTxJson('');
      }

      setFundingSubmitTxHash(result.fundingTxHash ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExternalFundingError(message);
      addLog(`External funding flow failed: ${message}`);
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
              {externalWallet ? 'External Wallet Funding (One Click)' : 'Internal Funding (One Click)'}
            </h3>
            <p style={{ marginTop: 0, fontSize: 13, color: '#475569' }}>
              SDK now provides a high-level flow API. With external wallet on, it will open + sign +
              submit automatically. With external wallet off, it performs a standard internal-funding
              open request.
            </p>

            {externalWallet ? (
              <div
                style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: 10,
                  background: '#ffffff',
                  marginBottom: 10,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>External Wallet (CCC)</div>
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
                  Connect external wallet first, then load its funding lock script into request params.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      void openExternalWalletConnectModal();
                    }}
                    style={{
                      border: '1px solid #1d4ed8',
                      borderRadius: 8,
                      padding: '6px 10px',
                      background: '#2563eb',
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    {connectedExternalWallet ? 'Switch External Wallet' : 'Connect External Wallet'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void disconnectExternalWallet();
                    }}
                    disabled={!connectedExternalWallet}
                    style={{
                      border: '1px solid #cbd5e1',
                      borderRadius: 8,
                      padding: '6px 10px',
                      background: '#fff',
                      color: '#111827',
                      cursor: connectedExternalWallet ? 'pointer' : 'not-allowed',
                      opacity: connectedExternalWallet ? 1 : 0.65,
                    }}
                  >
                    Disconnect External Wallet
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSyncingExternalWalletScript(true);
                      void syncFundingScriptsFromConnectedExternalWallet(true)
                        .catch((error) => {
                          const message = error instanceof Error ? error.message : String(error);
                          setExternalFundingError(message);
                          addLog(`Load wallet script failed: ${message}`);
                        })
                        .finally(() => {
                          setIsSyncingExternalWalletScript(false);
                        });
                    }}
                    disabled={!connectedExternalWallet || isSyncingExternalWalletScript}
                    style={{
                      border: '1px solid #0f766e',
                      borderRadius: 8,
                      padding: '6px 10px',
                      background: '#ecfeff',
                      color: '#0f766e',
                      cursor:
                        connectedExternalWallet && !isSyncingExternalWalletScript ? 'pointer' : 'not-allowed',
                      opacity: connectedExternalWallet ? 1 : 0.65,
                    }}
                  >
                    {isSyncingExternalWalletScript
                      ? 'Loading Wallet Script...'
                      : 'Load Wallet Script to Params'}
                  </button>
                </div>
                <div style={{ fontSize: 12, color: '#334155' }}>
                  CCC wallet: {connectedExternalWallet?.name ?? 'Not connected'}
                  {externalWalletAddress ? ` | address: ${shorten(externalWalletAddress, 20, 10)}` : ''}
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 10, fontSize: 12, color: '#475569' }}>
                Internal wallet mode uses node-managed CKB key and performs standard channel open.
              </div>
            )}

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
                onClick={() => {
                  void applyExternalFundingDefaults();
                }}
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 10px', background: '#fff', cursor: 'pointer' }}
              >
                {externalWallet ? 'Use Connected Wallet Script + Peer' : 'Use Node Defaults (Pubkey + Scripts)'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void startExternalFunding();
                }}
                disabled={!fiber.isRunning || isOpeningExternalFunding || !externalFundingPeerPubkey.trim()}
                style={{ border: '1px solid #0f766e', borderRadius: 8, padding: '7px 10px', background: '#14b8a6', color: '#fff', cursor: fiber.isRunning ? 'pointer' : 'not-allowed', opacity: fiber.isRunning ? 1 : 0.65 }}
              >
                {isOpeningExternalFunding
                  ? externalWallet
                    ? 'Running External Funding Flow...'
                    : 'Opening Internal Channel...'
                  : externalWallet
                    ? 'Open Channel (Auto Sign + Submit)'
                    : 'Open Channel (Internal Funding)'}
              </button>
            </div>

            {externalFundingSession && (
              <p style={{ marginTop: 10, fontSize: 13 }}>
                Pending Channel ID: <strong>{externalFundingSession.channelId}</strong>
              </p>
            )}

            <ExternalFundingDebugControls
              shutdownScriptJson={shutdownScriptJson}
              setShutdownScriptJson={setShutdownScriptJson}
              fundingLockScriptJson={fundingLockScriptJson}
              setFundingLockScriptJson={setFundingLockScriptJson}
              fundingLockCellDepsJson={fundingLockCellDepsJson}
              setFundingLockCellDepsJson={setFundingLockCellDepsJson}
              unsignedFundingTxJson={unsignedFundingTxJson}
              setUnsignedFundingTxJson={setUnsignedFundingTxJson}
              signedFundingTxJson={signedFundingTxJson}
              setSignedFundingTxJson={setSignedFundingTxJson}
              onCopyUnsignedTx={() => {
                void externalFundingDebugFlow.copyUnsignedFundingTx();
              }}
              onSignWithExternalWallet={() => {
                void externalFundingDebugFlow.signWithExternalWallet();
              }}
              isSigningExternalFunding={externalFundingDebugFlow.isSigningExternalFunding}
              onSubmitSignedFunding={() => {
                void externalFundingDebugFlow.submitSignedFunding();
              }}
              isSubmittingExternalFunding={externalFundingDebugFlow.isSubmittingExternalFunding}
              hasPendingExternalFundingSession={Boolean(externalFundingSession)}
            />

            {fundingSubmitTxHash && (
              <p style={{ marginTop: 10, fontSize: 13 }}>
                Funding Tx Hash: <strong>{fundingSubmitTxHash}</strong>
              </p>
            )}

            {externalFundingError && (
              <p style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>{externalFundingError}</p>
            )}

            {externalFundingDiagnostic && (
              <p style={{ marginTop: 10, color: '#0f172a', fontSize: 13 }}>{externalFundingDiagnostic}</p>
            )}
          </div>

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
