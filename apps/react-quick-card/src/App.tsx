import type { GetPaymentResult } from '@fiber-pay/sdk/browser';
import { ConnectButton, FiberPayQuickCard, useFiberNode } from '@fiber-pay/react';
import { useMemo, useState } from 'react';

export function App() {
  const [password, setPassword] = useState('demo-secret');
  const [eventLogs, setEventLogs] = useState<string[]>([]);

  const fiber = useFiberNode({
    network: 'testnet',
    walletId: 'quick-card-connect-demo',
  });

  const addLog = (message: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    setEventLogs((prev) => [`[${ts}] ${message}`, ...prev].slice(0, 10));
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

  const nodeSummary = useMemo(() => {
    if (!fiber.nodeInfo?.pubkey) {
      return 'Not connected';
    }
    const pubkey = fiber.nodeInfo.pubkey;
    return `${pubkey.slice(0, 10)}...${pubkey.slice(-8)}`;
  }, [fiber.nodeInfo?.pubkey]);

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 860, margin: '0 auto' }}>
      <h1>Fiber Pay React SDK Demo</h1>
      <p>
        This page simulates a downstream integration. It demonstrates both{' '}
        <code>ConnectButton</code> and <code>FiberPayQuickCard</code> usage.
      </p>

      <section
        style={{
          marginTop: 20,
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 16,
          background: '#fafafa',
        }}
      >
        <h2 style={{ marginTop: 0 }}>1) ConnectButton integration</h2>
        <p style={{ marginTop: 0 }}>
          Shared hook mode with custom connected dropdown, using password strategy.
        </p>

        <label style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ marginLeft: 8, padding: '6px 8px', borderRadius: 8, border: '1px solid #d1d5db' }}
          />
        </label>

        <ConnectButton
          fiber={fiber}
          strategy="password"
          password={password}
          onConnect={(_node, info) => {
            addLog(`ConnectButton connected: ${info.pubkey.slice(0, 12)}...`);
          }}
          onDisconnect={() => {
            addLog('ConnectButton disconnected');
          }}
          onError={(msg) => {
            addLog(`ConnectButton error: ${msg}`);
          }}
          renderConnectedDropdown={({ fiber: dropdownFiber, disconnect }) => (
            <div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Connected via custom dropdown</div>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                State: <strong>{dropdownFiber.state}</strong>
              </div>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                Node: {dropdownFiber.nodeInfo?.pubkey?.slice(0, 20) ?? 'n/a'}
              </div>
              <button
                type="button"
                onClick={() => {
                  void disconnect();
                }}
                style={{
                  marginTop: 10,
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                Disconnect
              </button>
            </div>
          )}
        />

        <div style={{ marginTop: 12, fontSize: 13 }}>
          <div>
            Hook state: <strong>{fiber.state}</strong>
          </div>
          <div>
            Node: <strong>{nodeSummary}</strong>
          </div>
        </div>

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
          {eventLogs.length === 0 ? 'No events yet.' : eventLogs.map((line) => <div key={line}>{line}</div>)}
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
        <h2 style={{ marginTop: 0 }}>2) FiberPayQuickCard integration</h2>
      <p>
        This is the existing minimal demo of the <code>FiberPayQuickCard</code> component from{' '}
        <code>@fiber-pay/react</code>.
      </p>
      <FiberPayQuickCard
        network="testnet"
        title="Quick Card"
        onInvoiceCreated={handleInvoiceCreated}
        onPaymentResult={handlePaymentResult}
        onError={handleError}
      />
      </section>
    </div>
  );
}
