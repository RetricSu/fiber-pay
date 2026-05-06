import type { GetPaymentResult } from '@fiber-pay/sdk/browser';
import { ConnectButton, FiberPayQuickCard, useFiberNode } from '@fiber-pay/react';
import { type CSSProperties, useMemo, useState } from 'react';

type ConnectStrategy = 'password' | 'passkey';

interface RuntimeSnapshot {
  nodeId: string;
  version: string;
  peers: number;
  channels: number;
}

function shorten(value: string, head = 10, tail = 8): string {
  if (!value || value.length <= head + tail + 3) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

const sourceLinks = [
  {
    label: 'ConnectButton source',
    href: 'https://github.com/RetricSu/fiber-pay/blob/feat/react-quick-card-connect-demo/packages/react/src/connect-button.tsx',
  },
  {
    label: 'useFiberNode source',
    href: 'https://github.com/RetricSu/fiber-pay/blob/feat/react-quick-card-connect-demo/packages/react/src/use-fiber-node.ts',
  },
  {
    label: 'This demo page source',
    href: 'https://github.com/RetricSu/fiber-pay/blob/feat/react-quick-card-connect-demo/apps/react-quick-card/src/App.tsx',
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
  const [password, setPassword] = useState('demo-secret');
  const [eventLogs, setEventLogs] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);

  const fiber = useFiberNode({
    network: 'testnet',
    walletId: 'quick-card-connect-demo',
  });

  const addLog = (message: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    setEventLogs((prev) => [`[${ts}] ${message}`, ...prev].slice(0, 20));
  };

  const clearLogs = () => {
    setEventLogs([]);
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
    ],
    [fiber.isPasskeySupported, fiber.isRunning, fiber.nodeInfo?.pubkey, fiber.passkeyUnavailableReason, fiber.state],
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
                password={strategy === 'password' ? password : undefined}
              />
            </div>

            <div style={{ border: '1px solid #99f6e4', borderRadius: 10, padding: 10, background: '#f0fdfa' }}>
              <div style={{ fontSize: 12, color: '#0f766e', marginBottom: 8 }}>Themed + custom dropdown</div>
              <ConnectButton
                fiber={fiber}
                strategy={strategy}
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
            : eventLogs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}
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
