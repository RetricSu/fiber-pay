import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChannelState,
  ConfigBuilder,
  formatShannonsAsCkb,
  getLockBalanceShannons,
  scriptToAddress,
} from '@fiber-pay/sdk/browser';
import QRCode from 'qrcode';
import { useFiberNode } from './hooks/useFiberNode';
import { useFiberConsole } from './hooks/useFiberConsole';
import {
  Activity,
  Cable,
  CheckCircle2,
  Copy,
  CreditCard,
  Database,
  Globe,
  LoaderCircle,
  Play,
  QrCode,
  RefreshCw,
  Server,
  Square,
  Wallet,
  Eye,
  EyeOff,
  XCircle,
} from 'lucide-react';

function shorten(value: string, head = 14, tail = 10): string {
  if (!value || value.length <= head + tail + 3) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function asDecimal(hex: string | undefined): string {
  if (!hex) {
    return '-';
  }

  try {
    return BigInt(hex).toString();
  } catch {
    return hex;
  }
}

function asCkb(hex: string | undefined): string {
  if (!hex) {
    return '-';
  }

  try {
    return formatShannonsAsCkb(hex, 8);
  } catch {
    return hex;
  }
}

function App() {
  const preferredNetwork = useMemo<'testnet' | 'mainnet'>(() => {
    if (typeof window === 'undefined') {
      return 'testnet';
    }
    const search = new URLSearchParams(window.location.search);
    return search.get('network') === 'mainnet' ? 'mainnet' : 'testnet';
  }, []);

  const {
    network,
    startWithPassword,
    startWithPasskey,
    createPasskey,
    stop,
    state,
    nodeInfo,
    node,
    isPasskeySupported,
    passkeyUnavailableReason,
    hasPasskeyConfigured,
  } = useFiberNode(preferredNetwork);
  const {
    nodeInfo: latestNodeInfo,
    peers,
    channels,
    graphNodeCount,
    graphChannelCount,
    latestInvoice,
    invoiceLookup,
    latestPayment,
    paymentLookup,
    loading,
    activity,
    refreshSnapshot,
    refreshGraph,
    connectPeer,
    disconnectPeer,
    openChannel,
    closeChannel,
    createInvoice,
    queryInvoice,
    cancelInvoice,
    payInvoice,
    queryPayment,
  } = useFiberConsole(node, state === 'running', network);

  const [password, setPassword] = useState('demo-secret');
  const [connectAddress, setConnectAddress] = useState('');
  const [channelPeerId, setChannelPeerId] = useState('');
  const [channelFunding, setChannelFunding] = useState('120');
  const [invoiceAmount, setInvoiceAmount] = useState('3.5');
  const [invoiceDesc, setInvoiceDesc] = useState('Browser wallet demo payment');
  const [invoiceExpiry, setInvoiceExpiry] = useState('3600');
  const [invoiceToPay, setInvoiceToPay] = useState('');
  const [queryInvoiceHash, setQueryInvoiceHash] = useState('');
  const [queryPaymentHash, setQueryPaymentHash] = useState('');
  const [fundingAddress, setFundingAddress] = useState<string | null>(null);
  const [fundingUri, setFundingUri] = useState<string | null>(null);
  const [fundingQrDataUrl, setFundingQrDataUrl] = useState<string | null>(null);
  const [fundingAddressError, setFundingAddressError] = useState<string | null>(null);
  const [fundingBalanceShannons, setFundingBalanceShannons] = useState<bigint | null>(null);
  const [fundingBalanceError, setFundingBalanceError] = useState<string | null>(null);
  const [isFundingBalanceLoading, setIsFundingBalanceLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const autoConnectTriedRef = useRef(false);

  const runtimeInfo = latestNodeInfo ?? nodeInfo;

  const networkDefaults = useMemo(() => ConfigBuilder.getDefaults(network), [network]);
  const bootnodes = networkDefaults.bootnodes;
  const defaultFundingLockScript = runtimeInfo?.default_funding_lock_script;
  const isRunning = state === 'running';
  const isBooting = state === 'unlocking' || state === 'starting';
  const isStopping = state === 'stopping';
  const isRefreshBusy = Boolean(loading.refreshSnapshot || loading.refreshGraph);

  const handleRefreshAll = useCallback(() => {
    if (!isRunning) {
      return;
    }
    void refreshSnapshot();
    void refreshGraph();
  }, [isRunning, refreshGraph, refreshSnapshot]);

  const handleCopy = async (text: string) => {
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        console.error('Failed to copy text to clipboard:', err);
      }
    }
  };

  const handleQuickConnectBootnode = async (address: string) => {
    setConnectAddress(address);
    await connectPeer(address);
  };

  useEffect(() => {
    if (!isRunning) {
      autoConnectTriedRef.current = false;
      return;
    }

    if (peers.length > 0 || loading.connectPeer || autoConnectTriedRef.current) {
      return;
    }

    const firstBootnode = bootnodes[0];
    if (!firstBootnode) {
      return;
    }

    autoConnectTriedRef.current = true;
    setConnectAddress(firstBootnode);
    void connectPeer(firstBootnode);
  }, [bootnodes, connectPeer, isRunning, loading.connectPeer, peers.length]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!defaultFundingLockScript) {
        setFundingAddress(null);
        setFundingUri(null);
        setFundingQrDataUrl(null);
        setFundingAddressError(null);
        return;
      }

      try {
        const address = scriptToAddress(defaultFundingLockScript, network);
        const uri = `ckb:${address}`;
        const qrDataUrl = await QRCode.toDataURL(uri, {
          width: 220,
          margin: 1,
          errorCorrectionLevel: 'M',
        });

        if (cancelled) {
          return;
        }

        setFundingAddress(address);
        setFundingUri(uri);
        setFundingQrDataUrl(qrDataUrl);
        setFundingAddressError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setFundingAddress(null);
        setFundingUri(null);
        setFundingQrDataUrl(null);
        setFundingAddressError(error instanceof Error ? error.message : String(error));
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [defaultFundingLockScript, network]);

  const refreshFundingBalance = useCallback(async () => {
    if (!defaultFundingLockScript) {
      setFundingBalanceShannons(null);
      setFundingBalanceError(null);
      return;
    }

    setIsFundingBalanceLoading(true);
    setFundingBalanceError(null);

    try {
      const balance = await getLockBalanceShannons(networkDefaults.ckbRpcUrl, defaultFundingLockScript);
      setFundingBalanceShannons(balance);
    } catch (error) {
      setFundingBalanceShannons(null);
      setFundingBalanceError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsFundingBalanceLoading(false);
    }
  }, [defaultFundingLockScript, networkDefaults.ckbRpcUrl]);

  useEffect(() => {
    if (!defaultFundingLockScript || !isRunning) {
      setFundingBalanceShannons(null);
      setFundingBalanceError(null);
      setIsFundingBalanceLoading(false);
      return;
    }

    void refreshFundingBalance();
  }, [defaultFundingLockScript, isRunning, refreshFundingBalance]);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="title-wrap">
          <div className="logo-circle">
            <Server color="var(--accent-color)" size={28} />
          </div>
          <div>
            <h1>Fiber Browser Wallet Console</h1>
            <p className="text-secondary">WASM Node Playground for {network.toUpperCase()} Operations</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="network-pill">
            <Globe size={14} />
            <span>{network}</span>
          </div>
          <button
            className="btn btn-ghost"
            onClick={handleRefreshAll}
            disabled={!isRunning || isRefreshBusy}
            title="Refresh snapshot and graph"
          >
            {isRefreshBusy ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="glass-panel panel-block animate-fade-in">
          <div className="panel-head">
            <h2 className="flex items-center gap-2">
              <Wallet size={18} />
              Node
            </h2>
          </div>

          {!isRunning ? (
            <div className="auth-layout">
              {(isBooting || isStopping) && (
                <div className="startup-loading">
                  <LoaderCircle size={18} className="animate-spin" />
                  <div>
                    <p>{isBooting ? 'Starting browser node...' : 'Stopping browser node...'}</p>
                    <p className="text-secondary">Current stage: {state}</p>
                  </div>
                </div>
              )}

              <div className="auth-methods">
                {isPasskeySupported && (
                  <div className="auth-group auth-card">
                    <p className="field-label">Passkey</p>
                    <p className="auth-note">WebAuthn PRF derives an independent key pair from your authenticator.</p>
                    {hasPasskeyConfigured ? (
                      <button className="btn btn-primary" onClick={() => void startWithPasskey()} disabled={isBooting || isStopping}>
                        <Play size={16} />
                        Login with Passkey
                      </button>
                    ) : (
                      <button className="btn btn-primary" onClick={() => void createPasskey('DemoUser')} disabled={isBooting || isStopping}>
                        <Play size={16} />
                        Register Passkey
                      </button>
                    )}
                  </div>
                )}

                {!isPasskeySupported && (
                  <div className="auth-group auth-card auth-card-disabled">
                    <p className="field-label">Passkey</p>
                    <p className="auth-note">Browser Passkey mode requires secure context, WebAuthn, and PRF support.</p>
                    <div className="alert alert-warning">
                      <XCircle size={16} />
                      <span>{passkeyUnavailableReason ?? 'Passkey is unavailable in this browser/environment.'}</span>
                    </div>
                  </div>
                )}

                {isPasskeySupported && (
                  <div className="or-divider" aria-hidden="true">
                    <span>OR</span>
                  </div>
                )}

                <div className="auth-group auth-card">
                  <p className="field-label">Password</p>
                  <p className="auth-note">Password + local random salt (IndexedDB) derives another independent key pair.</p>
                  <div className="password-row">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="input"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Unlock password"
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-inline"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button className="btn" onClick={() => void startWithPassword(password)} disabled={isBooting || isStopping}>
                    <Play size={16} />
                    Start Node with Password
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="runtime-grid">
                <div className="metric-tile">
                  <p className="metric-label">Node Pubkey</p>
                  <p className="metric-value mono">{shorten(runtimeInfo?.pubkey ?? '-', 16, 10)}</p>
                </div>
                <div className="metric-tile">
                  <p className="metric-label">Version</p>
                  <p className="metric-value mono">{runtimeInfo?.version ?? '-'}</p>
                </div>
                <div className="metric-tile">
                  <p className="metric-label">Peers / Channels</p>
                  <p className="metric-value">{peers.length} / {channels.length}</p>
                </div>
                <div className="metric-tile">
                  <p className="metric-label">Graph</p>
                  <p className="metric-value">{graphNodeCount} nodes / {graphChannelCount} channels</p>
                </div>
              </div>

              <div className="table-wrap mt-4">
                <div className="table-head">
                  <h3>Node Basic Info</h3>
                  <button className="btn btn-ghost" onClick={() => void handleCopy(JSON.stringify(runtimeInfo ?? {}, null, 2))}>
                    <Copy size={14} />
                    Copy JSON
                  </button>
                </div>
                <div className="info-grid">
                  <div className="info-item"><p className="field-label">Name</p><p>{runtimeInfo?.node_name ?? '-'}</p></div>
                  <div className="info-item"><p className="field-label">Chain Hash</p><p className="mono">{runtimeInfo?.chain_hash ?? '-'}</p></div>
                  <div className="info-item"><p className="field-label">Commit</p><p className="mono">{runtimeInfo?.commit_hash ?? '-'}</p></div>
                  <div className="info-item"><p className="field-label">node_info peers</p><p>{asDecimal(runtimeInfo?.peers_count)}</p></div>
                  <div className="info-item"><p className="field-label">node_info channels</p><p>{asDecimal(runtimeInfo?.channel_count)}</p></div>
                  <div className="info-item"><p className="field-label">pending channels</p><p>{asDecimal(runtimeInfo?.pending_channel_count)}</p></div>
                </div>

                {runtimeInfo?.features?.length ? (
                  <div className="chip-list mt-4">
                    {runtimeInfo.features.map((feature) => <span key={feature} className="chip">{feature}</span>)}
                  </div>
                ) : null}
              </div>

              <div className="result-box mt-4 funding-box">
                <div className="table-head">
                  <h3 className="flex items-center gap-2"><QrCode size={16} /> Funding / Recharge</h3>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost" onClick={() => void refreshFundingBalance()} disabled={isFundingBalanceLoading || !defaultFundingLockScript}>
                      {isFundingBalanceLoading ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      Refresh Balance
                    </button>
                    {fundingAddress && (
                      <button className="btn btn-ghost" onClick={() => void handleCopy(fundingAddress)}>
                        <Copy size={14} />
                        Copy Address
                      </button>
                    )}
                  </div>
                </div>

                {fundingAddressError ? (
                  <div className="alert alert-warning"><XCircle size={16} /><span>{fundingAddressError}</span></div>
                ) : (
                  <>
                    <p className="field-label">Funding Address</p>
                    <p className="mono break-anywhere">{fundingAddress ?? '-'}</p>
                    <p className="text-secondary">URI: <span className="mono">{fundingUri ?? '-'}</span></p>
                    <p className="text-secondary">CKB RPC: <span className="mono">{networkDefaults.ckbRpcUrl}</span></p>
                    <p className="text-secondary">
                      Balance:{' '}
                      {isFundingBalanceLoading
                        ? <span className="mono">loading...</span>
                        : fundingBalanceShannons !== null
                          ? <span className="mono">{formatShannonsAsCkb(fundingBalanceShannons, 8)} CKB ({fundingBalanceShannons.toString()} shannons)</span>
                          : <span className="mono">-</span>}
                    </p>
                    {fundingBalanceError && (
                      <div className="alert alert-warning"><XCircle size={16} /><span>{fundingBalanceError}</span></div>
                    )}
                    {fundingQrDataUrl && <div className="qr-wrap"><img src={fundingQrDataUrl} alt="Funding address QR" className="qr-image" /></div>}
                  </>
                )}
              </div>

              <div className="mt-4">
                <button className="btn" onClick={() => void stop()} disabled={isStopping}>
                  <Square size={16} fill="currentColor" />
                  {isStopping ? 'Stopping...' : 'Stop Node'}
                </button>
              </div>
            </>
          )}
        </section>

        <section className="glass-panel panel-block animate-fade-in" style={{ animationDelay: '60ms' }}>
          <div className="panel-head">
            <h2 className="flex items-center gap-2"><Cable size={18} /> Peer</h2>
          </div>

          <form
            className="op-form"
            onSubmit={(event) => {
              event.preventDefault();
              void connectPeer(connectAddress).then((ok) => {
                if (ok) setConnectAddress('');
              });
            }}
          >
            <label className="field-label">Connect Peer (WebSocket multiaddr)</label>
            <input
              className="input"
              value={connectAddress}
              onChange={(event) => setConnectAddress(event.target.value)}
              placeholder="/dns4/<host>/tcp/443/wss/p2p/<peerId>"
              disabled={!isRunning || loading.connectPeer}
            />
            <button className="btn btn-primary" type="submit" disabled={!isRunning || loading.connectPeer || !connectAddress.trim()}>
              {loading.connectPeer ? <LoaderCircle size={14} className="animate-spin" /> : <Cable size={14} />}
              Connect
            </button>
            <div className="quick-actions">
              {bootnodes.map((nodeAddress, index) => (
                <button
                  key={nodeAddress}
                  className="btn btn-ghost"
                  type="button"
                  disabled={!isRunning || loading.connectPeer}
                  onClick={() => void handleQuickConnectBootnode(nodeAddress)}
                >
                  Bootnode {index + 1}
                </button>
              ))}
            </div>
          </form>

          <div className="table-wrap mt-4">
            <div className="table-head"><h3>Connected Peers ({peers.length})</h3></div>
            {peers.length === 0 ? (
              <p className="text-secondary">No connected peers.</p>
            ) : (
              <div className="list-grid">
                {peers.map((peer) => (
                  <article key={peer.pubkey} className="list-item">
                    <div>
                      <p className="field-label">Peer Pubkey</p>
                      <p className="mono" title={peer.pubkey}>{shorten(peer.pubkey, 20, 12)}</p>
                    </div>
                    <div>
                      <p className="field-label">Address</p>
                      <p className="mono" title={peer.address}>{shorten(peer.address, 26, 12)}</p>
                    </div>
                    <button className="btn btn-ghost" onClick={() => void disconnectPeer(peer.pubkey)} disabled={loading.disconnectPeer}>
                      Disconnect
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="glass-panel panel-block animate-fade-in" style={{ animationDelay: '100ms' }}>
          <div className="panel-head">
            <h2 className="flex items-center gap-2"><Database size={18} /> Channel</h2>
          </div>

          <form
            className="op-form"
            onSubmit={(event) => {
              event.preventDefault();
              void openChannel(channelPeerId, channelFunding);
            }}
          >
            <label className="field-label">Open Channel</label>
            <input
              className="input"
              value={channelPeerId}
              onChange={(event) => setChannelPeerId(event.target.value)}
              placeholder="Peer ID"
              disabled={!isRunning || loading.openChannel}
            />
            <input
              className="input"
              value={channelFunding}
              onChange={(event) => setChannelFunding(event.target.value)}
              placeholder="Funding Amount (CKB)"
              disabled={!isRunning || loading.openChannel}
            />
            <button className="btn btn-primary" type="submit" disabled={!isRunning || loading.openChannel}>
              {loading.openChannel ? <LoaderCircle size={14} className="animate-spin" /> : <CreditCard size={14} />}
              Open Channel
            </button>
          </form>

          <div className="table-wrap mt-4">
            <div className="table-head"><h3>Channels ({channels.length})</h3></div>
            {channels.length === 0 ? (
              <p className="text-secondary">No channels found.</p>
            ) : (
              <div className="list-grid">
                {channels.map((channel) => {
                  const canClose =
                    channel.state.state_name !== ChannelState.Closed &&
                    channel.state.state_name !== ChannelState.ShuttingDown;

                  return (
                    <article key={channel.channel_id} className="list-item channel-item">
                      <div>
                        <p className="field-label">Channel ID</p>
                        <p className="mono" title={channel.channel_id}>{shorten(channel.channel_id, 20, 12)}</p>
                      </div>
                      <div>
                        <p className="field-label">Peer</p>
                        <p className="mono" title={channel.pubkey}>{shorten(channel.pubkey, 20, 12)}</p>
                      </div>
                      <div>
                        <p className="field-label">State</p>
                        <p>{channel.state.state_name}</p>
                      </div>
                      <div>
                        <p className="field-label">Local / Remote</p>
                        <p className="mono">{asCkb(channel.local_balance)} / {asCkb(channel.remote_balance)} CKB</p>
                      </div>
                      <div className="inline-actions">
                        <button
                          className="btn"
                          onClick={() => void closeChannel(channel.channel_id)}
                          disabled={!canClose || loading.closeChannel}
                        >
                          Close
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => void closeChannel(channel.channel_id, true)}
                          disabled={!canClose || loading.closeChannel}
                        >
                          Force Close
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="glass-panel panel-block animate-fade-in" style={{ animationDelay: '140ms' }}>
          <div className="panel-head">
            <h2 className="flex items-center gap-2"><CreditCard size={18} /> Payment</h2>
          </div>

          <div className="operation-grid">
            <form
              className="op-form"
              onSubmit={(event) => {
                event.preventDefault();
                void createInvoice(invoiceAmount, invoiceDesc, invoiceExpiry);
              }}
            >
              <label className="field-label">Create Invoice</label>
              <input className="input" value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} placeholder="Amount in CKB" disabled={!isRunning || loading.createInvoice} />
              <input className="input" value={invoiceDesc} onChange={(event) => setInvoiceDesc(event.target.value)} placeholder="Description" disabled={!isRunning || loading.createInvoice} />
              <input className="input" value={invoiceExpiry} onChange={(event) => setInvoiceExpiry(event.target.value)} placeholder="Expiry Seconds" disabled={!isRunning || loading.createInvoice} />
              <button className="btn btn-primary" type="submit" disabled={!isRunning || loading.createInvoice}>
                {loading.createInvoice ? <LoaderCircle size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Create
              </button>
            </form>

            <form
              className="op-form"
              onSubmit={(event) => {
                event.preventDefault();
                void payInvoice(invoiceToPay);
              }}
            >
              <label className="field-label">Pay Invoice</label>
              <textarea
                className="input textarea"
                value={invoiceToPay}
                onChange={(event) => setInvoiceToPay(event.target.value)}
                placeholder={`Paste ${network === 'mainnet' ? 'fibb1' : 'fibt1'}...`}
                disabled={!isRunning || loading.payInvoice}
              />
              <button className="btn btn-primary" type="submit" disabled={!isRunning || loading.payInvoice || !invoiceToPay.trim()}>
                {loading.payInvoice ? <LoaderCircle size={14} className="animate-spin" /> : <CreditCard size={14} />}
                Pay
              </button>
            </form>
          </div>

          <div className="operation-grid mt-4">
            <form
              className="op-form"
              onSubmit={(event) => {
                event.preventDefault();
                void queryInvoice(queryInvoiceHash);
              }}
            >
              <label className="field-label">Invoice Query / Cancel</label>
              <input className="input" value={queryInvoiceHash} onChange={(event) => setQueryInvoiceHash(event.target.value)} placeholder="Payment hash (0x...)" disabled={!isRunning || loading.queryInvoice || loading.cancelInvoice} />
              <div className="inline-actions">
                <button className="btn" type="submit" disabled={!isRunning || loading.queryInvoice || !queryInvoiceHash.trim()}>Query</button>
                <button className="btn" type="button" onClick={() => void cancelInvoice(queryInvoiceHash)} disabled={!isRunning || loading.cancelInvoice || !queryInvoiceHash.trim()}>Cancel</button>
              </div>
            </form>

            <form
              className="op-form"
              onSubmit={(event) => {
                event.preventDefault();
                void queryPayment(queryPaymentHash);
              }}
            >
              <label className="field-label">Payment Query</label>
              <input className="input" value={queryPaymentHash} onChange={(event) => setQueryPaymentHash(event.target.value)} placeholder="Payment hash (0x...)" disabled={!isRunning || loading.queryPayment} />
              <button className="btn" type="submit" disabled={!isRunning || loading.queryPayment || !queryPaymentHash.trim()}>Query</button>
            </form>
          </div>

          {(latestInvoice || invoiceLookup || paymentLookup || latestPayment) && (
            <div className="result-grid mt-4">
              {latestInvoice && (
                <div className="result-box">
                  <h3>Latest Invoice</h3>
                  <p className="mono break-anywhere">{latestInvoice.invoiceAddress}</p>
                  <p className="text-secondary">Hash: <span className="mono">{latestInvoice.paymentHash}</span></p>
                  <p className="text-secondary">Status: {latestInvoice.status}</p>
                </div>
              )}
              {invoiceLookup && (
                <div className="result-box">
                  <h3>Invoice Lookup</h3>
                  <p>Status: {invoiceLookup.status}</p>
                  <p className="text-secondary">Amount: <span className="mono">{invoiceLookup.invoice.amount ?? '-'}</span></p>
                </div>
              )}
              {paymentLookup && (
                <div className="result-box">
                  <h3>Payment Lookup</h3>
                  <p>Status: {paymentLookup.status}</p>
                  <p className="text-secondary">Fee: <span className="mono">{paymentLookup.fee}</span></p>
                  <p className="text-secondary">Updated: <span className="mono">{asDecimal(paymentLookup.last_updated_at)}</span></p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="glass-panel mt-4 animate-fade-in" style={{ animationDelay: '180ms' }}>
        <div className="panel-head">
          <h2 className="flex items-center gap-2">
            <Activity size={18} />
            Activity Log
          </h2>
        </div>
        {activity.length === 0 ? (
          <p className="text-secondary">No activity yet.</p>
        ) : (
          <div className="log-list">
            {activity.map((item) => (
              <article key={item.id} className={`log-item ${item.level}`}>
                <p className="mono">[{item.timestamp}] {item.message}</p>
                {item.detail && <p className="text-secondary break-anywhere">{item.detail}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
