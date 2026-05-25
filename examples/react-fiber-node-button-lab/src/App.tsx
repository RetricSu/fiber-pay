import { ccc } from '@ckb-ccc/connector-react';
import {
  FiberNodeButton,
  type FiberNodeButtonRenderAction,
  type FiberNodeButtonTabConfig,
  useFiberNode,
} from '@fiber-pay/react';
import {
  cccScriptToFiberScript,
  createCccSignFundingTx,
  resolveFundingLockCellDepsByKnownScript,
  type Script,
} from '@fiber-pay/sdk/browser';
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';

type ConnectStrategy = 'password' | 'passkey';

interface EventLogEntry {
  id: string;
  text: string;
}

const TESTNET_CKB_RPC_URL = 'https://testnet.ckbapp.dev/';

const integrationSnippet = `const fiber = useFiberNode({
  network: 'testnet',
  walletId: 'my-app-fiber-session',
  externalWallet,
});

<FiberNodeButton
  fiber={fiber}
  strategy={strategy}
  password={strategy === 'password' ? password : undefined}
  externalFunding={{ enabled: externalWallet, resolve: resolveExternalFunding }}
  onConnect={(_, info) => log('connected', info.pubkey)}
  onDisconnect={() => log('disconnected')}
  onError={(msg) => log('error', msg)}
  onLog={(msg) => log('fiber', msg)}
/>`;

function shorten(value: string, head = 10, tail = 8): string {
  if (!value || value.length <= head + tail + 3) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

const styles = {
  page: {
    minHeight: '100vh',
    padding: '28px 18px 36px',
    background:
      'radial-gradient(circle at 4% -12%, rgba(29,78,216,0.2), transparent 42%), radial-gradient(circle at 92% -8%, rgba(14,116,144,0.16), transparent 38%), #f3f6fb',
    color: '#0f172a',
    fontFamily: 'IBM Plex Sans, Avenir Next, Segoe UI, sans-serif',
  } satisfies CSSProperties,

  shell: {
    maxWidth: '1120px',
    margin: '0 auto',
    display: 'grid',
    gap: '16px',
  } satisfies CSSProperties,

  hero: {
    border: '1px solid #d6e0f0',
    borderRadius: '18px',
    padding: '18px 18px 16px',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(249,251,255,0.95) 100%)',
    boxShadow: '0 14px 30px -28px rgba(15, 23, 42, 0.45)',
  } satisfies CSSProperties,

  title: {
    margin: 0,
    fontSize: '1.55rem',
    letterSpacing: '-0.02em',
  } satisfies CSSProperties,

  subtitle: {
    margin: '8px 0 0',
    fontSize: '0.9rem',
    color: '#475569',
    maxWidth: '68ch',
    lineHeight: 1.4,
  } satisfies CSSProperties,

  layout: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '14px',
    alignItems: 'flex-start',
  } satisfies CSSProperties,

  panel: {
    flex: '1 1 520px',
    border: '1px solid #d6e0f0',
    borderRadius: '16px',
    padding: '14px',
    background: 'rgba(255,255,255,0.95)',
    boxShadow: '0 12px 28px -26px rgba(15, 23, 42, 0.5)',
    display: 'grid',
    gap: '12px',
  } satisfies CSSProperties,

  panelTitle: {
    margin: 0,
    fontSize: '1rem',
    letterSpacing: '-0.01em',
  } satisfies CSSProperties,

  panelLead: {
    margin: 0,
    fontSize: '0.8rem',
    color: '#64748b',
  } satisfies CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
  } satisfies CSSProperties,

  modeButton: {
    border: '1px solid #cfd8ea',
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
    border: '1px solid #cfd8ea',
    borderRadius: '10px',
    padding: '7px 9px',
    fontSize: '0.84rem',
    minWidth: '230px',
  } satisfies CSSProperties,

  fundingCard: {
    border: '1px solid #d7e0ee',
    borderRadius: '12px',
    padding: '10px',
    display: 'grid',
    gap: '7px',
    background: '#f8fbff',
  } satisfies CSSProperties,

  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: 700,
    color: '#1e293b',
    cursor: 'pointer',
    fontSize: '0.84rem',
  } satisfies CSSProperties,

  helperText: {
    margin: 0,
    fontSize: '0.78rem',
    color: '#64748b',
    lineHeight: 1.35,
  } satisfies CSSProperties,

  warningText: {
    margin: 0,
    fontSize: '0.78rem',
    color: '#b45309',
    lineHeight: 1.35,
  } satisfies CSSProperties,

  compactMeta: {
    margin: 0,
    fontSize: '0.78rem',
    color: '#475569',
    lineHeight: 1.35,
  } satisfies CSSProperties,

  statusGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: '7px',
  } satisfies CSSProperties,

  statusItem: {
    border: '1px solid #dbe4f3',
    borderRadius: '10px',
    padding: '7px 9px',
    fontSize: '0.78rem',
    color: '#334155',
    background: '#fff',
  } satisfies CSSProperties,

  statusLabel: {
    display: 'block',
    fontSize: '0.67rem',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
  } satisfies CSSProperties,

  statusValue: {
    display: 'block',
    marginTop: '2px',
    fontWeight: 700,
    color: '#0f172a',
    wordBreak: 'break-all',
  } satisfies CSSProperties,

  stepList: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
    display: 'grid',
    gap: '8px',
  } satisfies CSSProperties,

  stepItem: {
    border: '1px solid #dbe4f3',
    borderRadius: '10px',
    padding: '8px 10px',
    background: '#fff',
    display: 'grid',
    gap: '3px',
  } satisfies CSSProperties,

  stepTitle: {
    margin: 0,
    fontSize: '0.82rem',
    fontWeight: 700,
    color: '#0f172a',
  } satisfies CSSProperties,

  stepDesc: {
    margin: 0,
    fontSize: '0.76rem',
    color: '#64748b',
    lineHeight: 1.35,
  } satisfies CSSProperties,

  codeBlock: {
    margin: 0,
    border: '1px solid #cdd8ea',
    borderRadius: '10px',
    padding: '10px',
    background: '#0f172a',
    color: '#cbd5e1',
    fontFamily: 'IBM Plex Mono, Menlo, monospace',
    fontSize: '0.74rem',
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  } satisfies CSSProperties,

  eventBox: {
    border: '1px solid #cdd8ea',
    borderRadius: '10px',
    padding: '10px',
    background: '#0f172a',
    color: '#e2e8f0',
    fontFamily: 'IBM Plex Mono, Menlo, monospace',
    fontSize: '0.72rem',
    minHeight: '126px',
    maxHeight: '220px',
    overflowY: 'auto',
  } satisfies CSSProperties,

  actionButton: {
    border: '1px solid #cfd8ea',
    borderRadius: '8px',
    padding: '6px 10px',
    background: '#fff',
    color: '#0f172a',
    fontSize: '0.78rem',
    fontWeight: 700,
    cursor: 'pointer',
  } satisfies CSSProperties,

  errorBox: {
    border: '1px solid #fecaca',
    borderRadius: '10px',
    padding: '8px 10px',
    color: '#991b1b',
    background: '#fef2f2',
    fontSize: '0.78rem',
  } satisfies CSSProperties,
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
  const [customTabMode, setCustomTabMode] = useState(false);
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
    setEventLogs((prev) => [entry, ...prev].slice(0, 18));
  }, []);

  const clearLogs = useCallback(() => {
    setEventLogs([]);
  }, []);

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

  const externalWalletToggleLocked = fiber.isRunning || fiber.isStarting;

  const customI18n = useCallback((key: string, fallback: string) => {
    const dictionary: Record<string, string> = {
      'tabs.workbench': '操作台',
      'tabs.channels': '通道',
      'actions.payInvoice': '立即支付',
      'actions.payInvoice.loading': '支付中...',
      'workbench.payments.title': '支付操作',
      'workbench.openChannel.title': '开通道',
      'workbench.connectionPrep.title': '连接准备',
    };

    return dictionary[key] ?? fallback;
  }, []);

  const customTabs = useMemo<ReadonlyArray<FiberNodeButtonTabConfig>>(
    () => [
      { id: 'workbench' },
      {
        id: 'my-stats',
        label: (t) => t('demo.customTab.title', 'My Stats'),
        render: ({ state, t }) => (
          <section style={{ border: '1px solid #dbe4f3', borderRadius: 10, padding: 10 }}>
            <h4 style={{ margin: 0, fontSize: '0.86rem' }}>
              {t('demo.customTab.heading', 'Custom Runtime Stats')}
            </h4>
            <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: '#475569' }}>
              {t('demo.customTab.peerCount', 'Connected peers')}: {state.connectedPeers.length}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: '#475569' }}>
              {t('demo.customTab.activeChannels', 'Active channels')}: {state.activeChannelCount}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: '#475569' }}>
              {t('demo.customTab.paymentStatus', 'Payment status')}: {state.paymentResult?.status ?? 'Idle'}
            </p>
          </section>
        ),
      },
      { id: 'channels' },
      { id: 'diagnostics', hidden: true },
    ],
    [],
  );

  const customRenderAction = useCallback<FiberNodeButtonRenderAction>(({ id, defaultProps }) => {
    if (id !== 'pay-invoice') {
      return undefined;
    }

    return (
      <button
        type="button"
        style={{
          border: '1px solid #0f766e',
          borderRadius: 8,
          padding: '6px 10px',
          background: '#0f766e',
          color: '#fff',
          fontSize: '0.78rem',
          fontWeight: 700,
          cursor: defaultProps.disabled ? 'not-allowed' : 'pointer',
          opacity: defaultProps.disabled ? 0.6 : 1,
        }}
        disabled={defaultProps.disabled}
        onClick={() => {
          void defaultProps.onTrigger();
        }}
      >
        {defaultProps.loading ? '支付中...' : '立即支付（自定义）'}
      </button>
    );
  }, []);

  const hookStateItems = [
    { label: 'Node state', value: fiber.state },
    { label: 'Connected', value: fiber.isRunning ? 'Yes' : 'No' },
    {
      label: 'Funding mode',
      value: externalWallet ? 'External wallet (CCC signer)' : 'Internal wallet (node managed)',
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.hero}>
          <h1 style={styles.title}>FiberNodeButton Developer Demo</h1>
          <p style={styles.subtitle}>
            One component, one page: learn FiberNodeButton integration fast, then verify behavior in the
            live panel and runtime logs.
          </p>
        </header>

        <div style={styles.layout}>
          <aside style={styles.panel}>
            <h2 style={styles.panelTitle}>Integration Guide</h2>
            <p style={styles.panelLead}>Copy this wiring model and replace wallet/session config with your app values.</p>

            <ol style={styles.stepList}>
              <li style={styles.stepItem}>
                <p style={styles.stepTitle}>Step 1. Create one shared fiber hook</p>
                <p style={styles.stepDesc}>Keep useFiberNode in your page or provider and pass the same fiber object into FiberNodeButton.</p>
              </li>
              <li style={styles.stepItem}>
                <p style={styles.stepTitle}>Step 2. Choose auth strategy at runtime</p>
                <p style={styles.stepDesc}>Password and passkey can share one component, switch via strategy prop.</p>
              </li>
              <li style={styles.stepItem}>
                <p style={styles.stepTitle}>Step 3. Plug external funding only when needed</p>
                <p style={styles.stepDesc}>Use externalFunding.enabled plus resolve callback for CCC signer handoff.</p>
              </li>
              <li style={styles.stepItem}>
                <p style={styles.stepTitle}>Step 4. Subscribe to callback events</p>
                <p style={styles.stepDesc}>onConnect, onDisconnect, onError, onLog cover most app-level telemetry needs.</p>
              </li>
            </ol>

            <pre style={styles.codeBlock}>{integrationSnippet}</pre>

            <div>
              <div style={styles.row}>
                <h3 style={{ ...styles.panelTitle, fontSize: '0.92rem' }}>Runtime Events</h3>
                <button type="button" onClick={clearLogs} style={styles.actionButton}>
                  Clear Logs
                </button>
              </div>
              <div style={styles.eventBox}>
                {eventLogs.length === 0
                  ? 'No events yet. Connect the node and interact with the tabbed panel.'
                  : eventLogs.map((entry) => <div key={entry.id}>{entry.text}</div>)}
              </div>
            </div>
          </aside>

          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Live Playground</h2>
            <p style={styles.panelLead}>Choose strategy, toggle funding mode, then open FiberNodeButton.</p>

            <div style={styles.row}>
              <button
                type="button"
                onClick={() => setCustomTabMode(false)}
                style={{
                  ...styles.modeButton,
                  ...(customTabMode ? {} : styles.modeButtonActive),
                }}
              >
                Default Panel
              </button>
              <button
                type="button"
                onClick={() => setCustomTabMode(true)}
                style={{
                  ...styles.modeButton,
                  ...(customTabMode ? styles.modeButtonActive : {}),
                }}
              >
                Custom Tab Mode
              </button>
            </div>

            <p style={styles.helperText}>
              {customTabMode
                ? 'Custom mode enabled: adds a My Stats tab, hides Diagnostics, localizes labels, and overrides Pay action button.'
                : 'Default mode enabled: built-in tabs and default actions.'}
            </p>

            <div style={styles.row}>
              <button
                type="button"
                onClick={() => setStrategy('password')}
                style={{
                  ...styles.modeButton,
                  ...(strategy === 'password' ? styles.modeButtonActive : {}),
                }}
              >
                Password
              </button>
              <button
                type="button"
                onClick={() => setStrategy('passkey')}
                style={{
                  ...styles.modeButton,
                  ...(strategy === 'passkey' ? styles.modeButtonActive : {}),
                }}
              >
                Passkey
              </button>
              {strategy === 'password' ? (
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  style={styles.passwordInput}
                  placeholder="Password for node unlock"
                />
              ) : null}
            </div>

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
              tabs={customTabMode ? customTabs : undefined}
              t={customTabMode ? customI18n : undefined}
              renderAction={customTabMode ? customRenderAction : undefined}
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
                        fontWeight: 700,
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
                        fontWeight: 700,
                      }}
                    >
                      Disconnect External Wallet
                    </button>
                  </div>
                </div>
              )}
            />

            <div style={styles.fundingCard}>
              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={externalWallet}
                  disabled={externalWalletToggleLocked}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setExternalWallet(checked);
                    if (!checked) {
                      setExternalWalletAddress(null);
                    }
                  }}
                  style={{ width: 16, height: 16 }}
                />
                Use External Wallet (CCC Signer)
              </label>

              <p style={styles.helperText}>{externalWallet ? 'External mode enabled.' : 'Internal mode enabled.'}</p>

              {externalWalletToggleLocked ? (
                <p style={styles.warningText}>Disconnect the node before switching funding mode.</p>
              ) : null}
            </div>

            <p style={styles.compactMeta}>
              Node: {fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey, 18, 12) : 'Not connected'}
            </p>

            <div style={styles.statusGrid}>
              {hookStateItems.map((item) => (
                <div key={item.label} style={styles.statusItem}>
                  <span style={styles.statusLabel}>{item.label}</span>
                  <span style={styles.statusValue}>{item.value}</span>
                </div>
              ))}
            </div>

            {fiber.error ? <div style={styles.errorBox}>Hook error: {fiber.error}</div> : null}
          </section>
        </div>
      </div>
    </div>
  );
}
