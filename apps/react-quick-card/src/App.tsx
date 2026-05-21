import { ccc } from '@ckb-ccc/connector-react';
import { FiberNodeButton, FiberPayQuickCard, useFiberNode } from '@fiber-pay/react';
import {
  cccScriptToFiberScript,
  createCccSignFundingTx,
  resolveFundingLockCellDepsByKnownScript,
  type GetPaymentResult,
  type Script,
} from '@fiber-pay/sdk/browser';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';

type ConnectStrategy = 'password' | 'passkey';

interface EventLogEntry {
  id: string;
  text: string;
}

const TESTNET_CKB_RPC_URL = 'https://testnet.ckbapp.dev/';

function shorten(value: string, head = 10, tail = 8): string {
  if (!value || value.length <= head + tail + 3) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
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

  const [externalWalletAddress, setExternalWalletAddress] = useState<string | null>(null);

  const [eventLogs, setEventLogs] = useState<EventLogEntry[]>([]);

  const fiber = useFiberNode({
    network: 'testnet',
    walletId: 'quick-card-connect-demo',
    externalWallet,
  });

  const addLog = useCallback((message: string) => {
    const now = new Date();
    const ts = now.toISOString().slice(11, 19);
    const entry = {
      id: `${now.getTime()}-${crypto.randomUUID()}`,
      text: `[${ts}] ${message}`,
    };
    setEventLogs((prev) => [entry, ...prev].slice(0, 16));
  }, []);

  const clearLogs = useCallback(() => {
    setEventLogs([]);
  }, []);

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
        addLog(`External wallet address load failed: ${message}`);
      }
    };

    void loadAddress();

    return () => {
      cancelled = true;
    };
  }, [addLog, cccSigner, externalWallet]);

  const statusSummary = [
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
  ];

  const externalWalletToggleLocked = fiber.isRunning || fiber.isStarting;

  const resolveExternalFunding = useCallback(
    async () => {
      if (!cccSigner) {
        throw new Error('External wallet mode requires a connected CCC wallet signer.');
      }

      const addressObj = await cccSigner.getRecommendedAddressObj();
      const walletScript: Script = cccScriptToFiberScript(addressObj.script);
      const resolvedDeps = await resolveFundingLockCellDepsByKnownScript(
        cccSigner,
        walletScript,
        Object.values(ccc.KnownScript),
      );

      setExternalWalletAddress(addressObj.toString());

      if (resolvedDeps?.knownScript) {
        addLog(`Using CCC known script deps: ${resolvedDeps.knownScript}.`);
      }

      return {
        signFundingTx: createCccSignFundingTx(cccSigner),
        shutdownScript: walletScript,
        fundingLockScript: walletScript,
        fundingLockScriptCellDeps: resolvedDeps?.cellDeps,
        ckbRpcUrl: TESTNET_CKB_RPC_URL,
      };
    },
    [addLog, cccSigner],
  );

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 880, margin: '0 auto' }}>
      <h1>Fiber Pay React SDK: Clear Demo</h1>
      <p style={{ marginTop: 0, color: '#475569' }}>
        Minimal path only: connect, select peer, open channel, then use QuickCard.
      </p>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>1) Fiber Node Button</h2>

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

        <FiberNodeButton
          fiber={fiber}
          strategy={strategy}
          password={strategy === 'password' ? password : undefined}
          onLog={addLog}
          onConnect={(_node, info) => {
            addLog(`FiberNodeButton connected: ${shorten(info.pubkey, 12, 10)}`);
          }}
          onDisconnect={() => {
            addLog('FiberNodeButton disconnected.');
          }}
          onError={(msg) => {
            addLog(`FiberNodeButton error: ${msg}`);
          }}
          externalFunding={{
            enabled: externalWallet,
            resolve: resolveExternalFunding,
          }}
          renderConnectorSection={() => (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#475569' }}>
                CCC wallet: <strong>{connectedExternalWallet?.name ?? 'Not connected'}</strong>
                {externalWalletAddress ? ` | address: ${shorten(externalWalletAddress, 20, 10)}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
            </div>
          )}
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
              disabled={externalWalletToggleLocked}
              onChange={(e) => {
                const checked = e.target.checked;
                setExternalWallet(checked);
                if (!checked) {
                  setExternalWalletAddress(null);
                }
              }}
              style={{ width: 16, height: 16 }}
            />
            Use External Wallet (CCC Signer)
          </label>

          <p style={{ marginTop: 6, marginBottom: 0, fontSize: 12, color: '#64748b' }}>
            {externalWallet
              ? 'External mode is on. Channel opening will use CCC wallet signing.'
              : 'External mode is off. Channel opening uses internal node-managed funding.'}
          </p>
          {externalWalletToggleLocked && (
            <p style={{ marginTop: 6, marginBottom: 0, fontSize: 12, color: '#b45309' }}>
              Disconnect the node before switching funding mode.
            </p>
          )}

          {externalWallet && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
              CCC wallet: <strong>{connectedExternalWallet?.name ?? 'Not connected'}</strong>
              {externalWalletAddress ? ` | address: ${shorten(externalWalletAddress, 20, 10)}` : ''}
            </div>
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
        <h2 style={{ marginTop: 0 }}>2) Quick Payment UI (Legacy Comparison)</h2>
        <p style={{ marginTop: 0, color: '#475569', fontSize: 13 }}>
          `FiberNodeButton` already includes payment actions in its dropdown panel. This block remains
          only for side-by-side comparison.
        </p>

        <FiberPayQuickCard
          fiber={fiber}
          network="testnet"
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
