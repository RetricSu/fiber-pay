import { type CSSProperties, useCallback, useState } from 'react';
import { ConnectButton, useFiberNode } from '@fiber-pay/react';

type ConnectStrategy = 'password' | 'passkey';

interface EventLog {
  id: string;
  message: string;
}

function shorten(value: string, head = 12, tail = 10): string {
  if (!value || value.length <= head + tail + 3) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

const styles = {
  page: {
    minHeight: '100vh',
    margin: 0,
    background:
      'radial-gradient(circle at 8% -10%, rgba(29,78,216,0.26), transparent 45%), radial-gradient(circle at 96% 0%, rgba(20,184,166,0.22), transparent 42%), #edf3fb',
    color: '#0f172a',
    fontFamily: 'IBM Plex Sans, Avenir Next, Segoe UI, sans-serif',
    padding: '26px 16px 40px',
  } satisfies CSSProperties,

  shell: {
    maxWidth: '860px',
    margin: '0 auto',
    display: 'grid',
    gap: '16px',
  } satisfies CSSProperties,

  panel: {
    border: '1px solid #d4dfef',
    borderRadius: '16px',
    padding: '14px',
    background: 'rgba(255,255,255,0.94)',
    boxShadow: '0 14px 32px -28px rgba(15,23,42,0.55)',
  } satisfies CSSProperties,

  h1: {
    margin: 0,
    fontSize: '1.45rem',
    letterSpacing: '-0.02em',
  } satisfies CSSProperties,

  lead: {
    margin: '8px 0 0',
    color: '#475569',
    fontSize: '0.9rem',
    lineHeight: 1.45,
  } satisfies CSSProperties,

  sectionTitle: {
    margin: 0,
    fontSize: '0.97rem',
    letterSpacing: '-0.01em',
  } satisfies CSSProperties,

  row: {
    marginTop: '10px',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  } satisfies CSSProperties,

  modeButton: {
    border: '1px solid #c9d6e8',
    borderRadius: '999px',
    padding: '6px 12px',
    fontSize: '0.82rem',
    fontWeight: 700,
    background: '#fff',
    color: '#334155',
    cursor: 'pointer',
  } satisfies CSSProperties,

  modeButtonActive: {
    borderColor: '#1d4ed8',
    background: '#1d4ed8',
    color: '#fff',
  } satisfies CSSProperties,

  passwordInput: {
    border: '1px solid #c9d6e8',
    borderRadius: '10px',
    padding: '7px 10px',
    minWidth: '220px',
    fontSize: '0.84rem',
  } satisfies CSSProperties,

  hint: {
    margin: '10px 0 0',
    color: '#64748b',
    fontSize: '0.8rem',
  } satisfies CSSProperties,

  warn: {
    marginTop: '10px',
    border: '1px solid #fcd7a7',
    borderRadius: '10px',
    background: '#fffbeb',
    color: '#92400e',
    padding: '8px 10px',
    fontSize: '0.8rem',
  } satisfies CSSProperties,

  statusGrid: {
    marginTop: '10px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '8px',
  } satisfies CSSProperties,

  statusCard: {
    border: '1px solid #d6e0ee',
    borderRadius: '10px',
    padding: '8px 10px',
    background: '#f8fbff',
  } satisfies CSSProperties,

  statusLabel: {
    display: 'block',
    fontSize: '0.68rem',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
  } satisfies CSSProperties,

  statusValue: {
    display: 'block',
    marginTop: '3px',
    fontSize: '0.82rem',
    fontWeight: 700,
    color: '#0f172a',
    wordBreak: 'break-all',
  } satisfies CSSProperties,

  list: {
    margin: '8px 0 0',
    paddingLeft: '18px',
    color: '#334155',
    fontSize: '0.84rem',
    lineHeight: 1.5,
  } satisfies CSSProperties,

  logBox: {
    marginTop: '10px',
    border: '1px solid #d6e0ee',
    borderRadius: '10px',
    background: '#0f172a',
    color: '#e2e8f0',
    padding: '10px',
    fontFamily: 'IBM Plex Mono, Menlo, monospace',
    fontSize: '0.75rem',
    minHeight: '120px',
    maxHeight: '220px',
    overflowY: 'auto',
  } satisfies CSSProperties,

  clearButton: {
    border: '1px solid #c9d6e8',
    borderRadius: '8px',
    background: '#fff',
    color: '#1e293b',
    fontSize: '0.76rem',
    fontWeight: 700,
    padding: '6px 10px',
    cursor: 'pointer',
  } satisfies CSSProperties,
};

export default function App() {
  const [strategy, setStrategy] = useState<ConnectStrategy>('password');
  const [password, setPassword] = useState('demo-secret');
  const [logs, setLogs] = useState<ReadonlyArray<EventLog>>([]);

  const fiber = useFiberNode({
    network: 'testnet',
    walletId: 'example-min-connect',
  });

  const addLog = useCallback((message: string) => {
    const now = new Date();
    const ts = now.toISOString().slice(11, 19);
    const id = `${now.getTime()}-${crypto.randomUUID()}`;
    setLogs((prev) => [{ id, message: `[${ts}] ${message}` }, ...prev].slice(0, 20));
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <section style={styles.panel}>
          <h1 style={styles.h1}>React Minimal Integration Demo</h1>
          <p style={styles.lead}>
            This example only demonstrates useFiberNode and ConnectButton. It is intentionally minimal
            and does not include channel or payment workbench.
          </p>
        </section>

        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>Layer Scope</h2>
          <ul style={styles.list}>
            <li>Learn: useFiberNode lifecycle, strategy toggle, and ConnectButton event callbacks.</li>
            <li>Not in scope: FiberNodeButton advanced tabs, peer/channel ops, graph diagnostics.</li>
          </ul>
        </section>

        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>Connect Entry</h2>

          <div style={styles.row}>
            <button
              type="button"
              onClick={() => setStrategy('password')}
              style={{ ...styles.modeButton, ...(strategy === 'password' ? styles.modeButtonActive : {}) }}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => setStrategy('passkey')}
              style={{ ...styles.modeButton, ...(strategy === 'passkey' ? styles.modeButtonActive : {}) }}
            >
              Passkey
            </button>

            {strategy === 'password' ? (
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={styles.passwordInput}
                placeholder="Password"
              />
            ) : null}
          </div>

          {strategy === 'passkey' && !fiber.isPasskeySupported ? (
            <p style={styles.warn}>Passkey unavailable: {fiber.passkeyUnavailableReason ?? 'Unknown reason'}</p>
          ) : null}

          <p style={styles.hint}>Click ConnectButton to start or resume the browser node session.</p>

          <div style={{ marginTop: '10px' }}>
            <ConnectButton
              fiber={fiber}
              strategy={strategy}
              password={strategy === 'password' ? password : undefined}
              onConnect={(_node, info) => {
                addLog(`Connected: ${shorten(info.pubkey, 14, 10)}`);
              }}
              onDisconnect={() => {
                addLog('Disconnected');
              }}
              onError={(message) => {
                addLog(`Error: ${message}`);
              }}
              renderConnectedDropdown={({ disconnect, closeDropdown }) => (
                <div style={{ display: 'grid', gap: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#475569' }}>
                    Node pubkey: {fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey, 16, 12) : 'N/A'}
                  </div>
                  <button
                    type="button"
                    style={styles.clearButton}
                    onClick={() => {
                      void disconnect();
                      closeDropdown();
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              )}
            />
          </div>

          <div style={styles.statusGrid}>
            <div style={styles.statusCard}>
              <span style={styles.statusLabel}>Hook State</span>
              <span style={styles.statusValue}>{fiber.state}</span>
            </div>
            <div style={styles.statusCard}>
              <span style={styles.statusLabel}>Running</span>
              <span style={styles.statusValue}>{fiber.isRunning ? 'Yes' : 'No'}</span>
            </div>
            <div style={styles.statusCard}>
              <span style={styles.statusLabel}>Node Pubkey</span>
              <span style={styles.statusValue}>{fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey, 16, 12) : 'N/A'}</span>
            </div>
          </div>

          {fiber.error ? <p style={styles.warn}>Hook error: {fiber.error}</p> : null}
        </section>

        <section style={styles.panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={styles.sectionTitle}>Event Log</h2>
            <button type="button" style={styles.clearButton} onClick={clearLogs}>
              Clear
            </button>
          </div>
          <div style={styles.logBox}>
            {logs.length === 0
              ? 'No events yet. Connect or disconnect to see callback logs.'
              : logs.map((log) => <div key={log.id}>{log.message}</div>)}
          </div>
        </section>
      </div>
    </main>
  );
}
