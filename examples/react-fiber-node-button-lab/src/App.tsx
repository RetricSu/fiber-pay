import { FiberNodeButton, type UseFiberNodeOptions, useFiberNode } from '@fiber-pay/react';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';

type ConnectStrategy = 'password' | 'passkey';

interface EventLogEntry {
  id: string;
  text: string;
}

const RUSD_SCRIPT = {
  code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
  hash_type: 'type',
  args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
} as const;

const RUSD_NODE_CONFIG = {
  udtWhitelist: [
    {
      name: 'RUSD',
      script: RUSD_SCRIPT,
      cellDeps: [
        {
          typeId: {
            code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
            hash_type: 'type',
            args: '0x97d30b723c0b2c66e9cb8d4d0df4ab5d7222cbb00d4a9a2055ce2e5d7f0d8b0f',
          },
        },
      ],
      autoAcceptAmount: '1000000000',
    },
  ],
} satisfies NonNullable<UseFiberNodeOptions['nodeConfig']>;

const componentTheme = {
  '--fpay-accent': 'oklch(0.52 0.2 260)',
  '--fpay-accent-fg': 'oklch(0.98 0.005 260)',
  '--fpay-accent-subtle': 'oklch(0.94 0.035 260)',
  '--fpay-accent-border': 'oklch(0.78 0.09 260)',
  '--fpay-bg-elevated': 'oklch(0.99 0.004 260)',
  '--fpay-bg-secondary': 'oklch(0.96 0.01 260)',
  '--fpay-border': 'oklch(0.86 0.018 260)',
  '--fpay-text-primary': 'oklch(0.24 0.035 260)',
  '--fpay-text-secondary': 'oklch(0.49 0.03 260)',
  '--fpay-error': 'oklch(0.55 0.2 25)',
} as CSSProperties;

const DEFAULT_ASSET = { kind: 'ckb' } as const;

const DROPDOWN_STYLE = {
  width: 'min(520px, calc(100vw - 2rem))',
  maxHeight: 'min(760px, calc(100vh - 7rem))',
} as CSSProperties;

let logIdCounter = 0;

function shorten(value: string, head = 12, tail = 10): string {
  if (!value || value.length <= head + tail + 3) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function App() {
  const [strategy, setStrategy] = useState<ConnectStrategy>('passkey');
  const [password, setPassword] = useState('fiber-testnet-demo');
  const [eventLogs, setEventLogs] = useState<EventLogEntry[]>([]);

  const fiber = useFiberNode({
    network: 'testnet',
    walletId: 'fiber-node-button-live-preview',
    nodeConfig: RUSD_NODE_CONFIG,
  });

  useEffect(() => {
    if (fiber.passkeySupportReason && !fiber.isPasskeySupported) {
      setStrategy('password');
    }
  }, [fiber.isPasskeySupported, fiber.passkeySupportReason]);

  const addLog = useCallback((message: string) => {
    const now = new Date();
    setEventLogs((previous) =>
      [
        {
          id: `${now.getTime()}-${logIdCounter++}`,
          text: `${now.toLocaleTimeString([], { hour12: false })}  ${message}`,
        },
        ...previous,
      ].slice(0, 24),
    );
  }, []);

  const interactionLocked = fiber.isRunning || fiber.isStarting;
  const nodeStatus = fiber.isRunning ? 'Running' : fiber.isStarting ? 'Starting' : 'Ready';

  return (
    <main className="site-shell">
      <header className="site-header">
        <a className="wordmark" href="https://github.com/RetricSu/fiber-pay">
          <span className="wordmark-mark" aria-hidden="true">
            F
          </span>
          <span>fiber-pay</span>
        </a>

        <nav className="header-links" aria-label="Project links">
          <a href="https://retricsu.github.io/fiber-pay/">Docs</a>
          <a href="https://github.com/RetricSu/fiber-pay/tree/master/examples/react-fiber-node-button-lab">
            Source
          </a>
        </nav>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">
            <span className="live-dot" aria-hidden="true" />
            Live on Fiber testnet
          </p>
          <h1 id="page-title">
            <code>FiberNodeButton</code>, running for real.
          </h1>
          <p className="intro-copy">
            Start a browser Fiber node, manage channels, create invoices and send payments from the
            component shipped by the current workspace packages.
          </p>
        </div>

        <dl className="build-facts">
          <div>
            <dt>Package</dt>
            <dd>@fiber-pay/react</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>Testnet</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>Browser WASM</dd>
          </div>
        </dl>
      </section>

      <section className="demo" aria-labelledby="demo-title">
        <div className="demo-context">
          <p className="section-index">01 / LIVE COMPONENT</p>
          <h2 id="demo-title">The package is the preview.</h2>
          <p>
            Nothing below is mocked. Credentials and node data stay in this browser. Network calls
            use the public Fiber and CKB testnet services configured by the SDK.
          </p>

          <ol className="run-sequence">
            <li>
              <span>1</span>
              Choose Passkey or a local password.
            </li>
            <li>
              <span>2</span>
              Start the node with FiberNodeButton.
            </li>
            <li>
              <span>3</span>
              Open the panel to inspect every workflow.
            </li>
          </ol>

          <p className="testnet-note">
            Use testnet funds only. CKB and the configured RUSD asset are available inside the
            component after the node starts.
          </p>
        </div>

        <div className="component-workbench">
          <div className="workbench-header">
            <div className="runtime-status" aria-live="polite">
              <span
                className={`status-light status-light-${fiber.isRunning ? 'running' : 'idle'}`}
                aria-hidden="true"
              />
              <span>{nodeStatus}</span>
              {fiber.nodeInfo?.pubkey ? <code>{shorten(fiber.nodeInfo.pubkey)}</code> : null}
            </div>

            <fieldset className="strategy-switch">
              <legend className="sr-only">Node authentication method</legend>
              <button
                type="button"
                aria-pressed={strategy === 'passkey'}
                disabled={
                  interactionLocked ||
                  (fiber.passkeySupportReason !== null && !fiber.isPasskeySupported)
                }
                onClick={() => setStrategy('passkey')}
              >
                Passkey
              </button>
              <button
                type="button"
                aria-pressed={strategy === 'password'}
                disabled={interactionLocked}
                onClick={() => setStrategy('password')}
              >
                Password
              </button>
            </fieldset>
          </div>

          {strategy === 'password' ? (
            <label className="password-field">
              <span>Local node password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={interactionLocked}
                onChange={(event) => setPassword(event.target.value)}
              />
              <small>Used to encrypt this browser node. It is never sent to the demo host.</small>
            </label>
          ) : (
            <p className="passkey-note">
              Passkey uses WebAuthn PRF in a secure browser context. Password remains available as a
              fallback.
            </p>
          )}

          <div className="component-stage">
            <div className="stage-label">
              <span>Workspace component</span>
              <code>testnet</code>
            </div>

            <div className="component-anchor">
              <FiberNodeButton
                fiber={fiber}
                strategy={strategy}
                password={strategy === 'password' ? password : undefined}
                asset={DEFAULT_ASSET}
                initialFundingAmount="1000"
                invoiceAmount="1"
                style={componentTheme}
                dropdownStyle={DROPDOWN_STYLE}
                onConnect={(_node, info) => addLog(`Connected ${shorten(info.pubkey)}`)}
                onDisconnect={() => addLog('Disconnected')}
                onError={(message) => addLog(`Error: ${message}`)}
                onLog={addLog}
              />
            </div>
          </div>

          {fiber.error ? (
            <p className="runtime-error" role="alert">
              {fiber.error}
            </p>
          ) : null}
        </div>
      </section>

      <details className="event-console">
        <summary>
          <span>Runtime events</span>
          <span>{eventLogs.length || 'None yet'}</span>
        </summary>
        <div className="event-console-body">
          <button type="button" onClick={() => setEventLogs([])} disabled={eventLogs.length === 0}>
            Clear
          </button>
          <pre aria-live="polite">
            {eventLogs.length > 0
              ? eventLogs.map((entry) => entry.text).join('\n')
              : 'Start the node and component events will appear here.'}
          </pre>
        </div>
      </details>

      <footer>
        <span>Built from workspace packages</span>
        <span>Real testnet, no simulated state</span>
      </footer>
    </main>
  );
}
