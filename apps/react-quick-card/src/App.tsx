import { ccc } from '@ckb-ccc/connector-react';
import { ConnectButton, FiberPayQuickCard, useChannelOpenFlow, useFiberNode } from '@fiber-pay/react';
import { type GetPaymentResult, type HexString } from '@fiber-pay/sdk/browser';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';

type ConnectStrategy = 'password' | 'passkey';

interface EventLogEntry {
  id: string;
  text: string;
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

function normalizePubkey(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, '');
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

const cardStyle: CSSProperties = {
  marginTop: 20,
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 16,
  background: '#fafafa',
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

  const [externalFundingPeerPubkey, setExternalFundingPeerPubkey] = useState('');
  const [connectedPeerPubkeys, setConnectedPeerPubkeys] = useState<string[]>([]);
  const [peerAddressInput, setPeerAddressInput] = useState('');
  const [fundingAmountCkb, setFundingAmountCkb] = useState('1000');

  const [actionError, setActionError] = useState<string | null>(null);
  const [externalWalletAddress, setExternalWalletAddress] = useState<string | null>(null);
  const [isRefreshingPeers, setIsRefreshingPeers] = useState(false);
  const [isConnectingPeer, setIsConnectingPeer] = useState(false);
  const [isOpeningChannel, setIsOpeningChannel] = useState(false);

  const [eventLogs, setEventLogs] = useState<EventLogEntry[]>([]);

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
    setEventLogs((prev) => [entry, ...prev].slice(0, 16));
  };

  const clearLogs = () => {
    setEventLogs([]);
  };

  const channelOpenFlow = useChannelOpenFlow({
    node: fiber.node,
    onLog: addLog,
  });

  const refreshConnectedPeers = async () => {
    if (!fiber.node) {
      setConnectedPeerPubkeys([]);
      return;
    }

    setIsRefreshingPeers(true);
    setActionError(null);

    try {
      const peers = await fiber.node.listPeers();
      const pubkeys = peers.peers.map((peer) => peer.pubkey);
      setConnectedPeerPubkeys(pubkeys);
      setExternalFundingPeerPubkey((prev) => (prev.trim() ? prev : pubkeys[0] ?? prev));
      addLog(`Loaded connected peers: ${pubkeys.length}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      addLog(`Refresh peers failed: ${message}`);
    } finally {
      setIsRefreshingPeers(false);
    }
  };

  const connectPeerByAddress = async () => {
    if (!fiber.node) {
      setActionError('Node is not connected.');
      return;
    }

    if (!peerAddressInput.trim()) {
      setActionError('Peer address is empty.');
      return;
    }

    setIsConnectingPeer(true);
    setActionError(null);

    try {
      await fiber.node.connectPeer({
        address: peerAddressInput.trim(),
        save: true,
      });
      addLog('Peer connected from address input.');
      await refreshConnectedPeers();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      addLog(`Connect peer failed: ${message}`);
    } finally {
      setIsConnectingPeer(false);
    }
  };

  const openChannel = async () => {
    if (!fiber.node) {
      setActionError('Node is not connected.');
      return;
    }

    if (!externalFundingPeerPubkey.trim()) {
      setActionError('Target peer pubkey is empty.');
      return;
    }

    setActionError(null);
    setIsOpeningChannel(true);
    channelOpenFlow.reset();

    try {
      const targetPubkey = toHexPrefixed(externalFundingPeerPubkey);
      const normalizedTarget = normalizePubkey(targetPubkey);
      const isConnected = connectedPeerPubkeys.some(
        (peerPubkey) => normalizePubkey(peerPubkey) === normalizedTarget,
      );

      if (!isConnected) {
        throw new Error('Target peer is not connected. Connect or select a peer first.');
      }

      if (!externalWallet) {
        await channelOpenFlow.openChannel({
          pubkey: targetPubkey,
          fundingAmountCkb,
          externalWallet: false,
        });
        return;
      }

      if (!cccSigner) {
        throw new Error('External wallet mode requires a connected CCC wallet signer.');
      }

      const addressObj = await cccSigner.getRecommendedAddressObj();
      const walletScript = cccScriptToFiberScript(addressObj.script);
      const resolvedDeps = await resolveFundingLockCellDepsByKnownScript(cccSigner, walletScript);
      const signFundingTx = async (txForSigner: unknown): Promise<unknown> => {
        const cccSignedTx = await cccSigner.signTransaction(txForSigner as ccc.TransactionLike);
        return JSON.parse(JSON.stringify(cccSignedTx)) as unknown;
      };

      await channelOpenFlow.openChannel({
        pubkey: targetPubkey,
        fundingAmountCkb,
        externalWallet: true,
        shutdownScript: walletScript,
        fundingLockScript: walletScript,
        fundingLockScriptCellDeps: resolvedDeps?.cellDeps,
        signFundingTx,
        ckbRpcUrl: TESTNET_CKB_RPC_URL,
      });

      setExternalWalletAddress(addressObj.toString());
      if (resolvedDeps?.knownScript) {
        addLog(`Using CCC known script deps: ${resolvedDeps.knownScript}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      addLog(`Open channel failed: ${message}`);
    } finally {
      setIsOpeningChannel(false);
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

  useEffect(() => {
    if (!externalWallet || !cccSigner) {
      if (!externalWallet) {
        setExternalWalletAddress(null);
      }
      return;
    }

    let cancelled = false;

    const loadAddress = async () => {
      try {
        const addressObj = await cccSigner.getRecommendedAddressObj();
        if (!cancelled) {
          setExternalWalletAddress(addressObj.toString());
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setActionError(message);
      }
    };

    void loadAddress();

    return () => {
      cancelled = true;
    };
  }, [cccSigner, externalWallet]);

  useEffect(() => {
    if (!externalWallet || !fiber.isRunning || !fiber.node) {
      setConnectedPeerPubkeys([]);
      return;
    }

    void refreshConnectedPeers();
  }, [externalWallet, fiber.isRunning, fiber.node]);

  useEffect(() => {
    setExternalFundingPeerPubkey((prev) => (prev.trim() ? prev : connectedPeerPubkeys[0] ?? prev));
  }, [connectedPeerPubkeys]);

  const primaryError = actionError ?? channelOpenFlow.error;

  const statusSummary = useMemo(
    () => [
      { label: 'State', value: fiber.state },
      { label: 'Connected', value: fiber.isRunning ? 'Yes' : 'No' },
      { label: 'Node', value: fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey) : 'Not connected' },
      {
        label: 'Funding Mode',
        value: externalWallet ? 'External wallet (CCC signer)' : 'Internal wallet (node managed)',
      },
      {
        label: 'Passkey',
        value: fiber.isPasskeySupported ? 'Available' : fiber.passkeyUnavailableReason ?? 'Unavailable',
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

  const openChannelButtonText = !externalWallet
    ? 'Open Channel (Internal Funding)'
    : isOpeningChannel
      ? 'Open Channel (External Wallet Flow...)'
      : 'Open Channel (External Wallet One Click)';

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 880, margin: '0 auto' }}>
      <h1>Fiber Pay React SDK: Clear Demo</h1>
      <p style={{ marginTop: 0, color: '#475569' }}>
        Minimal path only: connect, select peer, open channel, then use QuickCard.
      </p>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>1) Connect</h2>

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
            Password
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
            Passkey
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

        <ConnectButton
          fiber={fiber}
          strategy={strategy}
          externalWallet={externalWallet}
          password={strategy === 'password' ? password : undefined}
          onConnect={(_node, info) => {
            addLog(`ConnectButton connected: ${shorten(info.pubkey, 12, 10)}`);
          }}
          onDisconnect={() => {
            addLog('ConnectButton disconnected.');
          }}
          onError={(msg) => {
            addLog(`ConnectButton error: ${msg}`);
          }}
        />

        <div
          style={{
            marginTop: 12,
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: 10,
            background: '#fff',
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 600,
              color: '#0f172a',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={externalWallet}
              onChange={(e) => setExternalWallet(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            Use External Wallet (CCC Signer)
          </label>

          <p style={{ marginTop: 6, marginBottom: 0, fontSize: 12, color: '#64748b' }}>
            {externalWallet
              ? 'External mode is on. Channel opening will use CCC wallet signing.'
              : 'External mode is off. Channel opening uses internal node-managed funding.'}
          </p>

          {externalWallet && (
            <>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
                CCC wallet: <strong>{connectedExternalWallet?.name ?? 'Not connected'}</strong>
                {externalWalletAddress ? ` | address: ${shorten(externalWalletAddress, 20, 10)}` : ''}
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 12, fontSize: 13, display: 'grid', gap: 6 }}>
          {statusSummary.map((item) => (
            <div key={item.label}>
              {item.label}: <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>2) Open Channel (One Click)</h2>
        <p style={{ marginTop: 0, fontSize: 13, color: '#475569' }}>
          Keep it simple: target peer + funding amount. External mode signs and submits automatically.
        </p>

        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 13 }}>
            Target Peer Pubkey
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
            Connect Peer by Address (optional)
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
              value={fundingAmountCkb}
              onChange={(e) => setFundingAmountCkb(e.target.value)}
              placeholder="1000"
              style={{ width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 8, border: '1px solid #cbd5e1' }}
            />
          </label>

          {channelOpenFlow.suggestedFundingAmountCkb && (
            <div style={{ fontSize: 12, color: '#0f766e', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Suggested amount: {channelOpenFlow.suggestedFundingAmountCkb} CKB</span>
              <button
                type="button"
                onClick={() => setFundingAmountCkb(channelOpenFlow.suggestedFundingAmountCkb ?? fundingAmountCkb)}
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
              void openChannel();
            }}
            disabled={!fiber.isRunning || isOpeningChannel || (externalWallet && !cccSigner)}
            style={{ border: '1px solid #0f766e', borderRadius: 8, padding: '7px 10px', background: '#14b8a6', color: '#fff', cursor: fiber.isRunning ? 'pointer' : 'not-allowed', opacity: fiber.isRunning ? 1 : 0.65 }}
          >
            {isOpeningChannel ? 'Opening Channel...' : openChannelButtonText}
          </button>
        </div>

        {channelOpenFlow.lastResult && (
          <div style={{ marginTop: 10, fontSize: 13, display: 'grid', gap: 4 }}>
            <div>
              Channel ID: <strong>{channelOpenFlow.lastResult.channelId}</strong>
            </div>
            {channelOpenFlow.lastResult.fundingTxHash && (
              <div>
                Funding Tx Hash: <strong>{channelOpenFlow.lastResult.fundingTxHash}</strong>
              </div>
            )}
          </div>
        )}

        {primaryError && <p style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>{primaryError}</p>}

        {channelOpenFlow.diagnostic && (
          <p style={{ marginTop: 10, color: '#0f172a', fontSize: 13 }}>{channelOpenFlow.diagnostic}</p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>3) Quick Payment UI</h2>
        <p style={{ marginTop: 0, color: '#475569', fontSize: 13 }}>
          Drop-in component for invoice creation and payment actions.
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

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: 'pointer', color: '#475569', fontSize: 13 }}>Event Logs</summary>
        <div
          style={{
            marginTop: 8,
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
        <button
          type="button"
          onClick={clearLogs}
          style={{
            marginTop: 8,
            border: '1px solid #d1d5db',
            borderRadius: 8,
            padding: '7px 10px',
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          Clear logs
        </button>
      </details>

      {fiber.error && (
        <div
          style={{
            marginTop: 12,
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
    </div>
  );
}
