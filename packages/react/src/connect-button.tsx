/**
 * ConnectButton — A unified connect/disconnect button for Fiber browser nodes.
 *
 * Supports three usage modes:
 * 1. **Standalone** — Internally manages `useFiberNode`. Simplest API.
 * 2. **External hook** — Accepts a pre-existing `useFiberNode` result via the `fiber` prop,
 *    so sibling components can share the same node instance.
 * 3. **Auto-detection** — If `fiber` is provided, uses it; otherwise creates its own.
 *
 * @example Standalone
 * ```tsx
 * <ConnectButton network="testnet" strategy="passkey" onConnect={(node) => setNode(node)} />
 * ```
 *
 * @example External hook
 * ```tsx
 * const fiber = useFiberNode({ network: "testnet" });
 * <ConnectButton fiber={fiber} strategy="passkey" />
 * ```
 */

import type { FiberBrowserNode, FiberWasmFactory, NodeInfoResult } from '@fiber-pay/sdk/browser';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { UseFiberNodeOptions, UseFiberNodeResult } from './use-fiber-node.js';
import { useFiberNode } from './use-fiber-node.js';

// =============================================================================
// Types
// =============================================================================

/** Credential strategy the ConnectButton should use */
export type ConnectStrategy = 'passkey' | 'password' | 'rawKey' | 'auto';

export interface ConnectButtonProps {
  /** Network to connect to. Required in standalone mode; ignored when `fiber` is provided. */
  network?: 'testnet' | 'mainnet';

  /**
   * Pre-existing hook result from `useFiberNode()`.
   * When provided, the button delegates to this instead of creating its own hook.
   */
  fiber?: UseFiberNodeResult;

  /** Credential strategy. Defaults to `"auto"`. */
  strategy?: ConnectStrategy;

  /** Password for the "password" strategy. */
  password?: string;

  /** Raw Fiber key (32 bytes) for the "rawKey" strategy. */
  rawKey?: Uint8Array;

  /** Raw CKB secret key (32 bytes) for the "rawKey" strategy (optional). */
  rawCkbKey?: Uint8Array;

  /** Wallet identifier for IndexedDB isolation. */
  walletId?: string;

  /** Display name for passkey registration. */
  passkeyUsername?: string;

  /** Optional WASM factory override. */
  wasmFactory?: FiberWasmFactory;

  /** Additional node config. */
  nodeConfig?: UseFiberNodeOptions['nodeConfig'];

  /** Additional CSS class name(s) for the root container. */
  className?: string;

  /** Inline styles for the root container. */
  style?: CSSProperties;

  /**
   * Called when the node reaches the "running" state.
   * Receives the `FiberBrowserNode` instance and its `NodeInfoResult`.
   */
  onConnect?: (node: FiberBrowserNode, nodeInfo: NodeInfoResult) => void;

  /** Called after the node is stopped. */
  onDisconnect?: () => void;

  /** Called when an error occurs. */
  onError?: (error: string) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function truncateNodeId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

// =============================================================================
// CSS (inline defaults using CSS custom properties)
// =============================================================================

const styles = {
  root: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } satisfies CSSProperties,

  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 1.25rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    borderRadius: '9999px',
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.15s, opacity 0.15s',
    lineHeight: 1.4,
  } satisfies CSSProperties,

  connectButton: {
    backgroundColor: 'var(--fpay-accent, #6366f1)',
    color: 'var(--fpay-accent-fg, #fff)',
  } satisfies CSSProperties,

  connectedButton: {
    backgroundColor: 'var(--fpay-accent-subtle, rgba(99,102,241,0.12))',
    color: 'var(--fpay-accent, #6366f1)',
    border: '1px solid var(--fpay-accent-border, rgba(99,102,241,0.35))',
  } satisfies CSSProperties,

  disabledButton: {
    opacity: 0.6,
    cursor: 'not-allowed',
  } satisfies CSSProperties,

  statusDot: {
    display: 'inline-block',
    width: '0.5rem',
    height: '0.5rem',
    borderRadius: '50%',
    backgroundColor: 'var(--fpay-accent, #6366f1)',
  } satisfies CSSProperties,

  errorText: {
    fontSize: '0.75rem',
    color: 'var(--fpay-error, #ef4444)',
    maxWidth: '220px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,

  dropdown: {
    position: 'absolute',
    right: 0,
    top: '100%',
    marginTop: '0.5rem',
    width: '280px',
    borderRadius: '0.75rem',
    border: '1px solid var(--fpay-border, #e5e7eb)',
    backgroundColor: 'var(--fpay-bg-elevated, #fff)',
    padding: '1rem',
    boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
    zIndex: 100,
  } satisfies CSSProperties,

  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.375rem 0',
    fontSize: '0.75rem',
  } satisfies CSSProperties,

  infoLabel: {
    color: 'var(--fpay-text-secondary, #6b7280)',
  } satisfies CSSProperties,

  infoValue: {
    fontFamily: 'ui-monospace, monospace',
    color: 'var(--fpay-text-primary, #111827)',
  } satisfies CSSProperties,

  separator: {
    borderTop: '1px solid var(--fpay-border, #e5e7eb)',
    margin: '0.75rem 0',
  } satisfies CSSProperties,

  disconnectButton: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.625rem 0.75rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    border: '1px solid var(--fpay-border, #e5e7eb)',
    borderRadius: '0.5rem',
    backgroundColor: 'var(--fpay-bg-secondary, #f9fafb)',
    color: 'var(--fpay-text-primary, #111827)',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  } satisfies CSSProperties,

  spinner: {
    animation: 'fpay-spin 1s linear infinite',
  } satisfies CSSProperties,
};

// Keyframes are injected once via a <style> tag
const KEYFRAMES_ID = 'fpay-connect-button-keyframes';
function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `@keyframes fpay-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}

// =============================================================================
// Spinner SVG
// =============================================================================

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={styles.spinner}
      role="img"
      aria-label="Loading"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// Chevron SVG for the dropdown toggle
function Chevron({ open }: { open: boolean }) {
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
      style={{ transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// =============================================================================
// Component
// =============================================================================

export function ConnectButton(props: ConnectButtonProps) {
  const {
    network = 'testnet',
    fiber: externalFiber,
    strategy = 'auto',
    password,
    rawKey,
    rawCkbKey,
    walletId,
    passkeyUsername = 'User',
    wasmFactory,
    nodeConfig,
    className,
    style,
    onConnect,
    onDisconnect,
    onError,
  } = props;

  // --- Hook: internal or external -------------------------------------------
  const internalFiber = useFiberNode({
    network,
    walletId,
    wasmFactory,
    nodeConfig,
    enabled: !externalFiber,
  });

  const fiber = externalFiber ?? internalFiber;

  const {
    state,
    node,
    nodeInfo,
    error,
    isStarting,
    isRunning,
    isPasskeySupported,
    passkeyUnavailableReason,
    hasPasskeyConfigured,
    createPasskeyAndStart,
    startWithPasskey,
    startWithPassword,
    startWithRawKey,
    stop,
  } = fiber;

  // --- Local UI state -------------------------------------------------------
  const [isConnecting, setIsConnecting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const effectiveIsStarting = isConnecting || isStarting;

  // Inject keyframes on mount
  useEffect(() => ensureKeyframes(), []);

  // Click-outside to close dropdown
  useEffect(() => {
    if (!showDropdown) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  // Notify parent on connect/disconnect
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (isRunning && !prevRunningRef.current && node && nodeInfo) {
      onConnect?.(node, nodeInfo);
    }
    if (!isRunning && prevRunningRef.current) {
      onDisconnect?.();
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, node, nodeInfo, onConnect, onDisconnect]);

  // Notify parent on error
  useEffect(() => {
    if (error) onError?.(error);
  }, [error, onError]);

  // --- Actions --------------------------------------------------------------

  const resolvedStrategy =
    strategy === 'auto'
      ? hasPasskeyConfigured && isPasskeySupported
        ? 'passkey'
        : password
          ? 'password'
          : rawKey
            ? 'rawKey'
            : 'passkey'
      : strategy;

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setLocalError(null);
    try {
      switch (resolvedStrategy) {
        case 'password':
          if (!password) throw new Error('Password is required for "password" strategy');
          await startWithPassword(password);
          break;
        case 'rawKey':
          if (!rawKey) throw new Error('rawKey is required for "rawKey" strategy');
          await startWithRawKey(rawKey, rawCkbKey);
          break;
        case 'passkey':
          if (hasPasskeyConfigured) {
            await startWithPasskey();
          } else {
            await createPasskeyAndStart(passkeyUsername);
          }
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(msg);
      onError?.(msg);
    } finally {
      setIsConnecting(false);
    }
  }, [
    resolvedStrategy,
    password,
    rawKey,
    rawCkbKey,
    passkeyUsername,
    hasPasskeyConfigured,
    startWithPassword,
    startWithPasskey,
    startWithRawKey,
    createPasskeyAndStart,
    onError,
  ]);

  const handleDisconnect = useCallback(async () => {
    try {
      await stop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(msg);
      onError?.(msg);
    } finally {
      setShowDropdown(false);
    }
  }, [stop, onError]);

  // --- Render ---------------------------------------------------------------

  const hasError = !!(error || localError);

  // Determine button content and behaviour
  let buttonLabel: ReactNode;
  let buttonOnClick: (() => void) | undefined;
  let buttonDisabled = false;
  let buttonStyle: CSSProperties;

  if (isRunning) {
    buttonLabel = (
      <>
        <span style={styles.statusDot} />
        <span style={{ fontFamily: 'ui-monospace, monospace' }}>
          {nodeInfo?.pubkey ? truncateNodeId(nodeInfo.pubkey) : 'Connected'}
        </span>
        <Chevron open={showDropdown} />
      </>
    );
    buttonOnClick = () => setShowDropdown((s) => !s);
    buttonStyle = { ...styles.button, ...styles.connectedButton };
  } else if (effectiveIsStarting) {
    buttonLabel = (
      <>
        <Spinner />
        Connecting…
      </>
    );
    buttonDisabled = true;
    buttonStyle = { ...styles.button, ...styles.connectButton, ...styles.disabledButton };
  } else {
    // Idle — label depends on strategy
    switch (resolvedStrategy) {
      case 'passkey':
        buttonLabel = hasPasskeyConfigured ? 'Connect with Passkey' : 'Connect via Passkey';
        if (!isPasskeySupported) {
          buttonLabel = 'Passkey unavailable';
          buttonDisabled = true;
        }
        break;
      case 'password':
        buttonLabel = 'Connect';
        break;
      case 'rawKey':
        buttonLabel = 'Connect';
        break;
    }
    buttonOnClick = handleConnect;
    buttonStyle = {
      ...styles.button,
      ...styles.connectButton,
      ...(buttonDisabled ? styles.disabledButton : {}),
    };
  }

  return (
    <div className={className} style={{ ...styles.root, ...style }} data-fpay-connect-button="">
      {/* Error / passkey unavailability message */}
      {(hasError ||
        (!isPasskeySupported && passkeyUnavailableReason && resolvedStrategy === 'passkey')) && (
        <span style={styles.errorText}>{error || localError || passkeyUnavailableReason}</span>
      )}

      {isRunning ? (
        <div style={{ position: 'relative' }} ref={dropdownRef}>
          <button type="button" onClick={buttonOnClick} style={buttonStyle}>
            {buttonLabel}
          </button>

          {showDropdown && (
            <div style={styles.dropdown}>
              {/* Node info */}
              {nodeInfo && (
                <>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Pubkey</span>
                    <span style={styles.infoValue}>{truncateNodeId(nodeInfo.pubkey)}</span>
                  </div>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>State</span>
                    <span style={styles.infoValue}>{state}</span>
                  </div>
                </>
              )}

              <div style={styles.separator} />

              {/* Disconnect */}
              <button
                type="button"
                onClick={() => void handleDisconnect()}
                style={styles.disconnectButton}
              >
                <span>Disconnect</span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>
          )}
        </div>
      ) : (
        <button type="button" onClick={buttonOnClick} disabled={buttonDisabled} style={buttonStyle}>
          {buttonLabel}
        </button>
      )}
    </div>
  );
}
