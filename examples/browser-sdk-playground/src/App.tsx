import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrowserRpcClient,
  ConfigBuilder,
  FiberBrowserNode,
  PasskeyCredentialProvider,
  PasswordCredentialProvider,
  formatShannonsAsCkb,
  getLockBalanceShannons,
  scriptToAddress,
  type NodeInfoResult,
  type PasskeySupportStatus,
} from '@fiber-pay/sdk/browser';

type Network = 'testnet' | 'mainnet';
type ConnectMode = 'password' | 'passkey';

function stringifyPretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function getPasskeyUnavailableReason(status: PasskeySupportStatus): string | null {
  if (status.supported) {
    return null;
  }

  switch (status.reason) {
    case 'insecure-context':
      return 'Passkey requires secure context (HTTPS or localhost).';
    case 'webauthn-unavailable':
      return 'WebAuthn API is unavailable in this browser.';
    case 'prf-unsupported':
      return 'WebAuthn PRF extension is not supported by current authenticator/browser.';
    case 'window-unavailable':
      return 'Passkey checks require a browser window context.';
    case 'unknown':
      return null;
    default:
      return 'Passkey requirements are not met in this environment.';
  }
}

export default function App() {
  const [network, setNetwork] = useState<Network>('testnet');
  const [connectMode, setConnectMode] = useState<ConnectMode>('password');
  const [password, setPassword] = useState('demo-secret');
  const [rpcUrl, setRpcUrl] = useState('http://127.0.0.1:8227');

  const [nodeState, setNodeState] = useState('idle');
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [nodeInfo, setNodeInfo] = useState<NodeInfoResult | null>(null);

  const [isPasskeySupported, setIsPasskeySupported] = useState(false);
  const [passkeyUnavailableReason, setPasskeyUnavailableReason] = useState<string | null>(null);

  const [rpcNodeInfoJson, setRpcNodeInfoJson] = useState('');
  const [rpcPeersJson, setRpcPeersJson] = useState('');
  const [rpcChannelsJson, setRpcChannelsJson] = useState('');
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [rpcLoading, setRpcLoading] = useState(false);

  const [fundingAddress, setFundingAddress] = useState<string | null>(null);
  const [fundingBalanceCkb, setFundingBalanceCkb] = useState<string | null>(null);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [fundingLoading, setFundingLoading] = useState(false);

  const nodeRef = useRef<FiberBrowserNode | null>(null);
  const rpcClient = useMemo(() => new BrowserRpcClient({ url: rpcUrl }), [rpcUrl]);

  useEffect(() => {
    PasskeyCredentialProvider.getSupportStatus()
      .then((status) => {
        const reason = getPasskeyUnavailableReason(status);
        setIsPasskeySupported(reason === null);
        setPasskeyUnavailableReason(reason);
      })
      .catch(() => {
        setIsPasskeySupported(false);
        setPasskeyUnavailableReason('Unable to detect passkey support.');
      });
  }, []);

  useEffect(() => {
    if (!nodeInfo?.default_funding_lock_script) {
      setFundingAddress(null);
      return;
    }

    try {
      setFundingAddress(scriptToAddress(nodeInfo.default_funding_lock_script, network));
    } catch (error) {
      setFundingAddress(null);
      setFundingError(error instanceof Error ? error.message : String(error));
    }
  }, [network, nodeInfo?.default_funding_lock_script]);

  const buildNode = useCallback(
    (credential: PasswordCredentialProvider | PasskeyCredentialProvider) => {
      const node = new FiberBrowserNode({
        network,
        credential,
        nodeConfig: {
          databasePrefix: `/example-browser-sdk-playground-${network}`,
        },
      });

      node.on('stateChange', (state) => {
        setNodeState(state);
      });

      node.on('error', (error: Error) => {
        setNodeError(error.message);
      });

      nodeRef.current = node;
      return node;
    },
    [network],
  );

  const startWithPassword = useCallback(async () => {
    try {
      setNodeError(null);
      const provider = new PasswordCredentialProvider(`example-browser-sdk-playground-${network}`);
      const node = buildNode(provider);
      const info = await node.start({ unlockParams: { password } });
      setNodeInfo(info);
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : String(error));
    }
  }, [buildNode, network, password]);

  const startWithPasskey = useCallback(async () => {
    try {
      setNodeError(null);
      const provider = new PasskeyCredentialProvider(`example-browser-sdk-playground-${network}`);
      const node = buildNode(provider);
      const info = await node.start();
      setNodeInfo(info);
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : String(error));
    }
  }, [buildNode, network]);

  const registerPasskeyAndStart = useCallback(async () => {
    try {
      setNodeError(null);
      const provider = new PasskeyCredentialProvider(`example-browser-sdk-playground-${network}`);
      await provider.register('BrowserSdkPlaygroundUser');
      const node = buildNode(provider);
      const info = await node.start();
      setNodeInfo(info);
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : String(error));
    }
  }, [buildNode, network]);

  const stopNode = useCallback(async () => {
    if (!nodeRef.current) {
      return;
    }

    try {
      await nodeRef.current.stop();
      setNodeInfo(null);
      setFundingAddress(null);
      setFundingBalanceCkb(null);
      setFundingError(null);
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const loadRpcSnapshot = useCallback(async () => {
    setRpcLoading(true);
    setRpcError(null);

    try {
      const [rpcNodeInfo, peers, channels] = await Promise.all([
        rpcClient.nodeInfo(),
        rpcClient.listPeers(),
        rpcClient.listChannels({ include_closed: true }),
      ]);

      setRpcNodeInfoJson(stringifyPretty(rpcNodeInfo));
      setRpcPeersJson(stringifyPretty(peers));
      setRpcChannelsJson(stringifyPretty(channels));
    } catch (error) {
      setRpcError(error instanceof Error ? error.message : String(error));
    } finally {
      setRpcLoading(false);
    }
  }, [rpcClient]);

  const refreshFundingBalance = useCallback(async () => {
    if (!nodeInfo?.default_funding_lock_script) {
      setFundingError('No default funding lock script available from local browser node.');
      return;
    }

    setFundingLoading(true);
    setFundingError(null);

    try {
      const defaults = ConfigBuilder.getDefaults(network);
      const balanceShannons = await getLockBalanceShannons(defaults.ckbRpcUrl, nodeInfo.default_funding_lock_script);
      setFundingBalanceCkb(formatShannonsAsCkb(balanceShannons, 8));
    } catch (error) {
      setFundingBalanceCkb(null);
      setFundingError(error instanceof Error ? error.message : String(error));
    } finally {
      setFundingLoading(false);
    }
  }, [network, nodeInfo?.default_funding_lock_script]);

  return (
    <main className="page">
      <div className="shell">
        <section className="card">
          <h1>Browser SDK Playground</h1>
          <p className="lead">
            This demo intentionally bypasses React helper components and uses browser SDK APIs directly.
          </p>
          <ul>
            <li>Learn: FiberBrowserNode lifecycle + BrowserRpcClient + browser-only helpers.</li>
            <li>Not here: ConnectButton/FiberNodeButton abstraction layer.</li>
          </ul>
        </section>

        <section className="card">
          <h2>Local Browser Node</h2>
          <div className="row">
            <button
              type="button"
              className={network === 'testnet' ? 'btn active' : 'btn'}
              onClick={() => setNetwork('testnet')}
            >
              Testnet
            </button>
            <button
              type="button"
              className={network === 'mainnet' ? 'btn active' : 'btn'}
              onClick={() => setNetwork('mainnet')}
            >
              Mainnet
            </button>
          </div>

          <div className="row">
            <button
              type="button"
              className={connectMode === 'password' ? 'btn active' : 'btn'}
              onClick={() => setConnectMode('password')}
            >
              Password
            </button>
            <button
              type="button"
              className={connectMode === 'passkey' ? 'btn active' : 'btn'}
              onClick={() => setConnectMode('passkey')}
            >
              Passkey
            </button>
          </div>

          {connectMode === 'password' ? (
            <input
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="Unlock password"
            />
          ) : (
            <p className="hint">
              Passkey support: {isPasskeySupported ? 'Supported' : 'Unavailable'}
              {passkeyUnavailableReason ? ` (${passkeyUnavailableReason})` : ''}
            </p>
          )}

          <div className="row">
            {connectMode === 'password' ? (
              <button type="button" className="btn primary" onClick={() => void startWithPassword()}>
                Start with Password
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void startWithPasskey()}
                  disabled={!isPasskeySupported}
                >
                  Start with Passkey
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void registerPasskeyAndStart()}
                  disabled={!isPasskeySupported}
                >
                  Register Passkey and Start
                </button>
              </>
            )}
            <button type="button" className="btn" onClick={() => void stopNode()}>
              Stop Node
            </button>
          </div>

          <div className="status-grid">
            <div className="status-item">
              <span>Node state</span>
              <strong>{nodeState}</strong>
            </div>
            <div className="status-item">
              <span>Pubkey</span>
              <strong>{nodeInfo?.pubkey ?? 'N/A'}</strong>
            </div>
            <div className="status-item">
              <span>Version</span>
              <strong>{nodeInfo?.version ?? 'N/A'}</strong>
            </div>
          </div>

          {nodeError ? <p className="error">Node error: {nodeError}</p> : null}
        </section>

        <section className="card">
          <h2>Browser-only Helpers</h2>
          <p className="hint">
            Uses scriptToAddress and getLockBalanceShannons against default funding lock script from local node.
          </p>
          <p>
            Funding address: <code>{fundingAddress ?? 'N/A (start local node first)'}</code>
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={() => void refreshFundingBalance()}>
              {fundingLoading ? 'Loading...' : 'Refresh Funding Balance'}
            </button>
            <span className="hint">Balance: {fundingBalanceCkb ? `${fundingBalanceCkb} CKB` : 'N/A'}</span>
          </div>
          {fundingError ? <p className="error">Helper error: {fundingError}</p> : null}
        </section>

        <section className="card">
          <h2>BrowserRpcClient Snapshot</h2>
          <p className="hint">Tip: default URL is local fnn RPC. Update URL and click refresh.</p>

          <input
            className="input"
            value={rpcUrl}
            onChange={(event) => setRpcUrl(event.target.value)}
            placeholder="http://127.0.0.1:8227"
          />

          <div className="row">
            <button type="button" className="btn primary" onClick={() => void loadRpcSnapshot()}>
              {rpcLoading ? 'Loading...' : 'Refresh RPC Snapshot'}
            </button>
          </div>

          {rpcError ? <p className="error">RPC error: {rpcError}</p> : null}

          <div className="json-grid">
            <article>
              <h3>nodeInfo()</h3>
              <pre>{rpcNodeInfoJson || 'No data yet'}</pre>
            </article>
            <article>
              <h3>listPeers()</h3>
              <pre>{rpcPeersJson || 'No data yet'}</pre>
            </article>
            <article>
              <h3>listChannels include_closed=true</h3>
              <pre>{rpcChannelsJson || 'No data yet'}</pre>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
