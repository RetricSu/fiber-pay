import { useState } from 'react';
import { useFiberNode } from './hooks/useFiberNode';
import { useFiberPayment } from './hooks/useFiberPayment';
import { Play, Square, Wallet, Zap, Copy, LoaderCircle, CheckCircle2, XCircle } from 'lucide-react';

function App() {
  const { start, stop, state, nodeInfo, error: nodeError, node } = useFiberNode('testnet');
  const { payInvoice, isPaying, paymentResult, error: payError } = useFiberPayment(node);

  const [password, setPassword] = useState('demo-secret');
  const [invoiceStr, setInvoiceStr] = useState('');

  const handleCopyNodeId = () => {
    if (nodeInfo?.node_id) {
      navigator.clipboard.writeText(nodeInfo.node_id);
      // normally show a toast here
    }
  };

  return (
    <div className="app-container">
      <div className="flex items-center gap-4 mb-4">
        <div style={{ background: 'var(--accent-glow)', padding: '12px', borderRadius: '50%' }}>
          <Zap color="var(--accent-color)" size={32} />
        </div>
        <div>
          <h1>Fiber Web Wallet</h1>
          <div className="text-secondary">WASM Node in browser</div>
        </div>
      </div>

      <div className="glass-panel mb-4 animate-fade-in">
        <div className="flex justify-between items-center mb-4">
          <h2 className="flex items-center gap-2">
            <Wallet size={20} />
            Node Control
          </h2>
          <div className="flex items-center gap-2 text-secondary">
            <div className={`status-dot ${state === 'running' ? 'active' : state === 'error' ? 'error' : state !== 'idle' && state !== 'stopped' ? 'loading' : 'inactive'}`} />
            <span style={{ textTransform: 'capitalize' }}>{state}</span>
          </div>
        </div>

        {nodeError && (
          <div className="mb-4 p-3" style={{ background: 'rgba(248,81,73,0.1)', border: '1px solid var(--error-color)', borderRadius: '6px', color: 'var(--error-color)' }}>
            {nodeError}
          </div>
        )}

        {state === 'idle' || state === 'stopped' || state === 'error' ? (
          <div className="flex flex-col gap-4">
            <input
              type="password"
              className="input"
              placeholder="Enter password to unlock wallet"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="btn btn-primary" onClick={() => start(password)}>
              <Play size={18} />
              Start WASM Node
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {nodeInfo && (
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                <div className="text-secondary mb-2 text-xs uppercase tracking-wider">Node ID</div>
                <div className="flex justify-between items-center">
                  <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', wordBreak: 'break-all', paddingRight: '12px' }}>
                    {nodeInfo.node_id}
                  </div>
                  <button className="btn" style={{ padding: '6px', minWidth: 'auto' }} onClick={handleCopyNodeId} title="Copy Node ID">
                    <Copy size={16} />
                  </button>
                </div>
              </div>
            )}
            <button className="btn" onClick={stop} disabled={state === 'stopping'}>
              {state === 'stopping' ? <LoaderCircle size={18} className="animate-spin" /> : <Square size={18} fill="currentColor" />}
              Stop Node
            </button>
          </div>
        )}
      </div>

      {/* Payment Panel - Only show when node is running */}
      {state === 'running' && (
        <div className="glass-panel animate-fade-in" style={{ animationDelay: '100ms' }}>
          <h2 className="flex items-center gap-2 mb-4">
            <Zap size={20} />
            Quick Payment
          </h2>
          
          <div className="flex flex-col gap-4">
            <input
              type="text"
              className="input"
              placeholder="Paste Invoice (fibt1...)"
              value={invoiceStr}
              onChange={(e) => setInvoiceStr(e.target.value)}
              disabled={isPaying}
            />
            
            <button 
              className="btn btn-primary" 
              onClick={() => payInvoice(invoiceStr)}
              disabled={!invoiceStr.trim() || isPaying}
            >
              {isPaying ? 'Processing...' : 'Pay Invoice'}
            </button>

            {payError && (
              <div className="flex items-center gap-2 mt-2" style={{ color: 'var(--error-color)' }}>
                <XCircle size={18} />
                <span>{payError}</span>
              </div>
            )}

            {paymentResult && paymentResult.status === 'Success' && (
              <div className="flex items-center gap-2 mt-2" style={{ color: 'var(--success-color)' }}>
                <CheckCircle2 size={18} />
                <span>Payment successful! (Fee: {paymentResult.fee})</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
