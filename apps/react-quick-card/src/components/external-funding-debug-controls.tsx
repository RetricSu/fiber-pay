interface ExternalFundingDebugControlsProps {
  shutdownScriptJson: string;
  setShutdownScriptJson: (value: string) => void;
  fundingLockScriptJson: string;
  setFundingLockScriptJson: (value: string) => void;
  fundingLockCellDepsJson: string;
  setFundingLockCellDepsJson: (value: string) => void;
  unsignedFundingTxJson: string;
  setUnsignedFundingTxJson: (value: string) => void;
  signedFundingTxJson: string;
  setSignedFundingTxJson: (value: string) => void;
  onCopyUnsignedTx: () => void;
  onSignWithExternalWallet: () => void;
  isSigningExternalFunding: boolean;
  onSubmitSignedFunding: () => void;
  isSubmittingExternalFunding: boolean;
  hasPendingExternalFundingSession: boolean;
}

export function ExternalFundingDebugControls(props: ExternalFundingDebugControlsProps) {
  const {
    shutdownScriptJson,
    setShutdownScriptJson,
    fundingLockScriptJson,
    setFundingLockScriptJson,
    fundingLockCellDepsJson,
    setFundingLockCellDepsJson,
    unsignedFundingTxJson,
    setUnsignedFundingTxJson,
    signedFundingTxJson,
    setSignedFundingTxJson,
    onCopyUnsignedTx,
    onSignWithExternalWallet,
    isSigningExternalFunding,
    onSubmitSignedFunding,
    isSubmittingExternalFunding,
    hasPendingExternalFundingSession,
  } = props;

  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', color: '#475569', fontSize: 13 }}>
        Advanced Debug Controls (optional)
      </summary>

      <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
        <label style={{ fontSize: 13 }}>
          Shutdown Script JSON (optional, defaults to node default script)
          <textarea
            value={shutdownScriptJson}
            onChange={(e) => setShutdownScriptJson(e.target.value)}
            rows={4}
            placeholder='{"code_hash":"0x...","hash_type":"type","args":"0x..."}'
            style={{ width: '100%', marginTop: 4, padding: '8px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
          />
        </label>

        <label style={{ fontSize: 13 }}>
          Funding Lock Script JSON (optional, defaults to node default script)
          <textarea
            value={fundingLockScriptJson}
            onChange={(e) => setFundingLockScriptJson(e.target.value)}
            rows={4}
            placeholder='{"code_hash":"0x...","hash_type":"type","args":"0x..."}'
            style={{ width: '100%', marginTop: 4, padding: '8px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
          />
        </label>

        <label style={{ fontSize: 13 }}>
          Funding Lock Script CellDeps JSON (optional)
          <textarea
            value={fundingLockCellDepsJson}
            onChange={(e) => setFundingLockCellDepsJson(e.target.value)}
            rows={3}
            placeholder='[{"out_point":{"tx_hash":"0x...","index":"0x0"},"dep_type":"code"}]'
            style={{ width: '100%', marginTop: 4, padding: '8px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
          />
        </label>

        <label style={{ display: 'block', fontSize: 13 }}>
          Unsigned Funding Tx JSON
          <textarea
            value={unsignedFundingTxJson}
            onChange={(e) => setUnsignedFundingTxJson(e.target.value)}
            rows={6}
            style={{ width: '100%', marginTop: 4, padding: '8px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onCopyUnsignedTx}
            style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 10px', background: '#fff', cursor: 'pointer' }}
          >
            Copy Unsigned Tx
          </button>
          <button
            type="button"
            onClick={onSignWithExternalWallet}
            disabled={isSigningExternalFunding}
            style={{ border: '1px solid #2563eb', borderRadius: 8, padding: '7px 10px', background: '#3b82f6', color: '#fff', cursor: 'pointer', opacity: isSigningExternalFunding ? 0.7 : 1 }}
          >
            {isSigningExternalFunding ? 'Signing...' : 'Sign with External Wallet'}
          </button>
        </div>

        <label style={{ display: 'block', fontSize: 13 }}>
          Signed Funding Tx JSON
          <textarea
            value={signedFundingTxJson}
            onChange={(e) => setSignedFundingTxJson(e.target.value)}
            rows={6}
            style={{ width: '100%', marginTop: 4, padding: '8px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onSubmitSignedFunding}
            disabled={!hasPendingExternalFundingSession || isSubmittingExternalFunding}
            style={{ border: '1px solid #0f766e', borderRadius: 8, padding: '7px 10px', background: '#0f766e', color: '#fff', cursor: hasPendingExternalFundingSession ? 'pointer' : 'not-allowed', opacity: hasPendingExternalFundingSession ? 1 : 0.65 }}
          >
            {isSubmittingExternalFunding ? 'Submitting...' : 'Submit Signed Funding Tx'}
          </button>
        </div>
      </div>
    </details>
  );
}
