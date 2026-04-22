/**
 * NodeInfoPanel — Displays Fiber browser node metadata, stats, and optional QR code.
 *
 * This is a stateless display component that polls the running node for stats
 * (peer count, channel count, CKB balance) and renders them with copy-to-clipboard
 * support and an optional QR code for the node's CKB address.
 *
 * @example
 * ```tsx
 * import { NodeInfoPanel } from "@fiber-pay/react";
 *
 * <NodeInfoPanel node={node} network="testnet" showQrCode />
 * ```
 */

import type { FiberBrowserNode } from '@fiber-pay/sdk/browser';
import {
  ConfigBuilder,
  formatShannonsAsCkb,
  getLockBalanceShannons,
  scriptToAddress,
} from '@fiber-pay/sdk/browser';
import {
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

// =============================================================================
// Types
// =============================================================================

export interface NodeInfoPanelProps {
  /** The running FiberBrowserNode instance. */
  node: FiberBrowserNode | null;

  /** Network (needed for address derivation and RPC URL defaults). */
  network: 'testnet' | 'mainnet';

  /** How often to refresh stats (ms). Default: 15000. */
  pollInterval?: number;

  /** Whether to show a QR code of the CKB address. Requires `qrcode.react` to be installed. */
  showQrCode?: boolean;

  /**
   * Optional QR code render function — allows consumers to bring their own QR library.
   * Called with the CKB address string. If not provided and `showQrCode` is true,
   * the component will attempt to dynamically import `qrcode.react`.
   */
  renderQrCode?: (value: string) => ReactNode;

  /** Additional CSS class name(s). */
  className?: string;

  /** Inline styles. */
  style?: CSSProperties;
}

interface NodeStats {
  pubkey: string;
  peers: number;
  channels: number;
  ckbAddress: string | null;
  balanceCkb: string | null;
  externalFunding: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

function truncateMiddle(str: string, left = 8, right = 8): string {
  if (str.length <= left + right + 3) return str;
  return `${str.slice(0, left)}…${str.slice(-right)}`;
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text);
}

async function fetchNodeStats(
  node: FiberBrowserNode,
  network: 'testnet' | 'mainnet',
): Promise<NodeStats> {
  const [nodeInfo, peers, channels] = await Promise.all([
    node.nodeInfo(),
    node.listPeers(),
    node.listChannels(),
  ]);

  const lockScript = nodeInfo.default_funding_lock_script;
  const ckbRpcUrl = ConfigBuilder.getDefaults(network).ckbRpcUrl;

  if (!lockScript || lockScript.args === '0x') {
    return {
      pubkey: nodeInfo.pubkey,
      peers: peers.peers.length,
      channels: channels.channels.length,
      ckbAddress: null,
      balanceCkb: null,
      externalFunding: true,
    };
  }

  const ckbAddress = scriptToAddress(lockScript, network);
  const balanceShannons = await getLockBalanceShannons(ckbRpcUrl, lockScript);
  const balanceCkb = formatShannonsAsCkb(balanceShannons, 4);

  return {
    pubkey: nodeInfo.pubkey,
    peers: peers.peers.length,
    channels: channels.channels.length,
    ckbAddress,
    balanceCkb,
    externalFunding: false,
  };
}

// =============================================================================
// CSS
// =============================================================================

const styles = {
  root: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '0.875rem',
    color: 'var(--fpay-text-primary, #111827)',
  } satisfies CSSProperties,

  idle: {
    padding: '1rem',
    textAlign: 'center',
    color: 'var(--fpay-text-secondary, #6b7280)',
    fontSize: '0.75rem',
  } satisfies CSSProperties,

  loading: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0',
    fontSize: '0.75rem',
    color: 'var(--fpay-text-secondary, #6b7280)',
  } satisfies CSSProperties,

  errorBox: {
    marginBottom: '0.5rem',
    padding: '0.375rem 0.5rem',
    fontSize: '0.75rem',
    borderRadius: '0.5rem',
    border: '1px solid var(--fpay-error-border, rgba(239,68,68,0.3))',
    backgroundColor: 'var(--fpay-error-bg, rgba(239,68,68,0.1))',
    color: 'var(--fpay-error, #ef4444)',
  } satisfies CSSProperties,

  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.375rem 0',
  } satisfies CSSProperties,

  infoLabel: {
    fontSize: '0.75rem',
    color: 'var(--fpay-text-secondary, #6b7280)',
  } satisfies CSSProperties,

  infoValueWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
  } satisfies CSSProperties,

  infoValue: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.75rem',
    color: 'var(--fpay-text-primary, #111827)',
  } satisfies CSSProperties,

  copyButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.25rem',
    borderRadius: '0.25rem',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: 'var(--fpay-text-secondary, #6b7280)',
    transition: 'color 0.15s',
  } satisfies CSSProperties,

  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.5rem',
    marginTop: '0.5rem',
  } satisfies CSSProperties,

  statCard: {
    padding: '0.375rem 0.5rem',
    textAlign: 'center',
    borderRadius: '0.5rem',
    border: '1px solid var(--fpay-border, #e5e7eb)',
    backgroundColor: 'var(--fpay-bg-secondary, #f9fafb)',
  } satisfies CSSProperties,

  statLabel: {
    fontSize: '0.625rem',
    color: 'var(--fpay-text-secondary, #6b7280)',
  } satisfies CSSProperties,

  statValue: {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--fpay-text-primary, #111827)',
  } satisfies CSSProperties,

  qrContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.25rem',
    marginTop: '0.75rem',
    padding: '0.5rem',
    borderRadius: '0.5rem',
    border: '1px solid var(--fpay-border, #e5e7eb)',
    backgroundColor: 'var(--fpay-bg-secondary, #f9fafb)',
  } satisfies CSSProperties,

  qrCaption: {
    fontSize: '0.625rem',
    color: 'var(--fpay-text-secondary, #6b7280)',
  } satisfies CSSProperties,

  balanceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginTop: '0.5rem',
    paddingTop: '0.5rem',
    borderTop: '1px solid var(--fpay-border, #e5e7eb)',
  } satisfies CSSProperties,

  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.25rem 0.625rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    borderRadius: '9999px',
    marginBottom: '0.5rem',
  } satisfies CSSProperties,
};

const STATUS_COLORS: Record<string, { bg: string; fg: string; dot: string }> = {
  idle: { bg: 'rgba(107,114,128,0.1)', fg: '#6b7280', dot: '#9ca3af' },
  unlocking: { bg: 'rgba(245,158,11,0.1)', fg: '#d97706', dot: '#f59e0b' },
  starting: { bg: 'rgba(245,158,11,0.1)', fg: '#d97706', dot: '#f59e0b' },
  running: { bg: 'rgba(34,197,94,0.1)', fg: '#16a34a', dot: '#22c55e' },
  stopping: { bg: 'rgba(245,158,11,0.1)', fg: '#d97706', dot: '#f59e0b' },
  stopped: { bg: 'rgba(107,114,128,0.1)', fg: '#6b7280', dot: '#9ca3af' },
  error: { bg: 'rgba(239,68,68,0.1)', fg: '#dc2626', dot: '#ef4444' },
};

// =============================================================================
// Sub-components
// =============================================================================

function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function InfoRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <div style={styles.infoValueWrapper}>
        <span style={styles.infoValue}>{truncateMiddle(value, 6, 6)}</span>
        {copyable && (
          <button
            type="button"
            onClick={() => copyToClipboard(value)}
            style={styles.copyButton}
            title="Copy to clipboard"
            aria-label={`Copy ${label}`}
          >
            <CopyIcon />
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function NodeInfoPanel(props: NodeInfoPanelProps) {
  const {
    node,
    network,
    pollInterval = 15000,
    showQrCode = false,
    renderQrCode,
    className,
    style,
  } = props;

  const [stats, setStats] = useState<NodeStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const cancelledRef = useRef(false);

  // QR code dynamic import state
  const [QRComponent, setQRComponent] = useState<ComponentType<{
    value: string;
    size?: number;
    bgColor?: string;
    fgColor?: string;
  }> | null>(null);

  // Attempt to dynamically import qrcode.react if needed
  useEffect(() => {
    let cancelled = false;
    if (!showQrCode || renderQrCode) return;
    import('qrcode.react')
      .then((mod: Record<string, unknown>) => {
        if (cancelled) return;
        const Comp = (mod.QRCodeSVG ?? mod.default) as
          | ComponentType<{
              value: string;
              size?: number;
              bgColor?: string;
              fgColor?: string;
            }>
          | undefined;
        if (Comp) setQRComponent(() => Comp);
      })
      .catch(() => {
        // qrcode.react not installed — silently skip
      });
    return () => {
      cancelled = true;
    };
  }, [showQrCode, renderQrCode]);

  const loadingRef = useRef(false);

  const loadStats = useCallback(async () => {
    if (!node || node.state !== 'running' || loadingRef.current) return;
    loadingRef.current = true;
    setStatsLoading(true);
    setStatsError(null);
    try {
      const data = await fetchNodeStats(node, network);
      if (!cancelledRef.current) setStats(data);
    } catch (e) {
      if (!cancelledRef.current) {
        setStatsError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      loadingRef.current = false;
      if (!cancelledRef.current) setStatsLoading(false);
    }
  }, [node, network]);

  useEffect(() => {
    cancelledRef.current = false;

    if (!node || node.state !== 'running') {
      setStats(null);
      setStatsError(null);
      return;
    }

    void loadStats();
    const interval = setInterval(() => void loadStats(), pollInterval);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [node, node?.state, pollInterval, loadStats]);

  // --- Render ---------------------------------------------------------------

  if (!node) {
    return (
      <div className={className} style={{ ...styles.root, ...style }} data-fpay-node-info="">
        <div style={styles.idle}>No node connected</div>
      </div>
    );
  }

  const nodeState = node.state;
  const statusColor = STATUS_COLORS[nodeState] ?? STATUS_COLORS.idle;

  return (
    <div className={className} style={{ ...styles.root, ...style }} data-fpay-node-info="">
      {/* Status badge */}
      <div
        style={{
          ...styles.statusBadge,
          backgroundColor: statusColor.bg,
          color: statusColor.fg,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: '0.5rem',
            height: '0.5rem',
            borderRadius: '50%',
            backgroundColor: statusColor.dot,
          }}
        />
        {nodeState}
      </div>

      {/* Loading indicator */}
      {statsLoading && !stats && (
        <div style={styles.loading}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            role="img"
            aria-label="Loading"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 12 12"
              to="360 12 12"
              dur="1s"
              repeatCount="indefinite"
            />
          </svg>
          Loading…
        </div>
      )}

      {/* Error */}
      {statsError && <div style={styles.errorBox}>{statsError}</div>}

      {/* Stats */}
      {stats && (
        <>
          <InfoRow label="Pubkey" value={stats.pubkey} copyable />

          {stats.externalFunding ? (
            <div style={{ padding: '0.25rem 0', fontSize: '0.75rem', color: '#6b7280' }}>
              External funding mode
            </div>
          ) : stats.ckbAddress ? (
            <InfoRow label="CKB Address" value={stats.ckbAddress} copyable />
          ) : null}

          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Peers</div>
              <div style={styles.statValue}>{stats.peers}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Channels</div>
              <div style={styles.statValue}>{stats.channels}</div>
            </div>
          </div>

          {/* QR Code */}
          {showQrCode && stats.ckbAddress && (
            <div style={styles.qrContainer}>
              {renderQrCode ? (
                renderQrCode(stats.ckbAddress)
              ) : QRComponent ? (
                <QRComponent
                  value={stats.ckbAddress}
                  size={120}
                  bgColor="transparent"
                  fgColor="currentColor"
                />
              ) : (
                <div style={{ fontSize: '0.625rem', color: '#9ca3af' }}>
                  Install qrcode.react for QR code
                </div>
              )}
              <span style={styles.qrCaption}>Scan to deposit CKB</span>
              <div style={styles.balanceRow}>
                <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Balance</span>
                <span
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                  }}
                >
                  {stats.balanceCkb ?? '—'} CKB
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
