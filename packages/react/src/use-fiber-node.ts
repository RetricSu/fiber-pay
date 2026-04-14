import {
  type BrowserNodeState,
  FiberBrowserNode,
  type FiberBrowserNodeConfig,
  type FiberWasmFactory,
  type NodeInfoResult,
  PasskeyCredentialProvider,
  type PasskeySupportReason,
  type PasskeySupportStatus,
  PasswordCredentialProvider,
} from '@fiber-pay/sdk/browser';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseFiberNodeOptions {
  network: 'testnet' | 'mainnet';
  walletId?: string;
  nodeConfig?: FiberBrowserNodeConfig['nodeConfig'];
  wasmFactory?: FiberWasmFactory;
}

export interface UseFiberNodeResult {
  state: BrowserNodeState;
  node: FiberBrowserNode | null;
  nodeInfo: NodeInfoResult | null;
  error: string | null;
  isPasskeySupported: boolean;
  passkeySupportReason: PasskeySupportReason | null;
  passkeyUnavailableReason: string | null;
  hasPasskeyConfigured: boolean;
  startWithPassword: (password: string) => Promise<void>;
  createPasskeyAndStart: (username?: string) => Promise<void>;
  startWithPasskey: () => Promise<void>;
  stop: () => Promise<void>;
}

const PASSKEY_UNAVAILABLE_REASON_TEXT: Record<
  Exclude<PasskeySupportReason, 'supported'>,
  string
> = {
  'window-unavailable': 'Passkey is not available because there is no browser window context.',
  'insecure-context': 'Passkey requires a secure context (HTTPS or localhost).',
  'webauthn-unavailable': 'This browser does not provide WebAuthn support for passkeys.',
  'prf-unsupported': 'This browser or authenticator does not support WebAuthn PRF.',
  unknown: 'Passkey support could not be fully detected in this environment.',
};

export function isPasskeyPotentiallySupported(status: PasskeySupportStatus): boolean {
  return status.supported || status.reason === 'unknown';
}

export function toPasskeyUnavailableReason(reason: PasskeySupportReason): string | null {
  if (reason === 'supported') {
    return null;
  }
  return PASSKEY_UNAVAILABLE_REASON_TEXT[reason];
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

interface NodeEventListeners {
  stateChange: (nextState: BrowserNodeState) => void;
  error: (nextError: Error) => void;
}

export function useFiberNode(options: UseFiberNodeOptions): UseFiberNodeResult {
  const walletId = options.walletId ?? `wallet-${options.network}`;
  const [state, setState] = useState<BrowserNodeState>('idle');
  const [nodeInfo, setNodeInfo] = useState<NodeInfoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPasskeySupported, setIsPasskeySupported] = useState(false);
  const [passkeySupportReason, setPasskeySupportReason] = useState<PasskeySupportReason | null>(
    null,
  );
  const [passkeyUnavailableReason, setPasskeyUnavailableReason] = useState<string | null>(null);
  const [hasPasskeyConfigured, setHasPasskeyConfigured] = useState(false);

  const nodeRef = useRef<FiberBrowserNode | null>(null);
  const isMountedRef = useRef(true);
  const nodeListenersRef = useRef<NodeEventListeners | null>(null);

  const detachNodeListeners = useCallback((node: FiberBrowserNode | null) => {
    if (!node || !nodeListenersRef.current) {
      return;
    }

    node.off('stateChange', nodeListenersRef.current.stateChange);
    node.off('error', nodeListenersRef.current.error);
    nodeListenersRef.current = null;
  }, []);

  useEffect(
    () => () => {
      isMountedRef.current = false;

      const node = nodeRef.current;
      nodeRef.current = null;

      if (node) {
        detachNodeListeners(node);
        void node.stop().catch(() => {});
      }
    },
    [detachNodeListeners],
  );

  useEffect(() => {
    let cancelled = false;

    PasskeyCredentialProvider.getSupportStatus()
      .then((status) => {
        if (!cancelled) {
          const supported = isPasskeyPotentiallySupported(status);
          setIsPasskeySupported(supported);
          setPasskeySupportReason(status.reason);
          setPasskeyUnavailableReason(supported ? null : toPasskeyUnavailableReason(status.reason));
        }
      })
      .catch((supportError) => {
        if (!cancelled) {
          setIsPasskeySupported(false);
          setPasskeySupportReason('unknown');
          setPasskeyUnavailableReason(toPasskeyUnavailableReason('unknown'));
        }

        if (supportError instanceof Error) {
          console.warn('[fiber-pay/react] Failed to detect passkey support:', supportError.message);
        }
      });

    const provider = new PasskeyCredentialProvider(walletId);
    setHasPasskeyConfigured(provider.isConfigured());

    return () => {
      cancelled = true;
    };
  }, [walletId]);

  const initNode = useCallback(
    (credential: PasswordCredentialProvider | PasskeyCredentialProvider) => {
      if (nodeRef.current) {
        const existingState = nodeRef.current.state;
        if (existingState !== 'idle' && existingState !== 'stopped' && existingState !== 'error') {
          throw new Error('Node already running');
        }

        detachNodeListeners(nodeRef.current);
        nodeRef.current = null;
      }

      const nodeConfig: ConstructorParameters<typeof FiberBrowserNode>[0] = {
        network: options.network,
        credential,
        nodeConfig: {
          databasePrefix: `/${walletId}`,
          ...(options.nodeConfig ?? {}),
        },
      };

      if (options.wasmFactory) {
        nodeConfig.wasmFactory = options.wasmFactory;
      }

      const node = new FiberBrowserNode(nodeConfig);

      nodeRef.current = node;

      const listeners: NodeEventListeners = {
        stateChange: (nextState) => {
          if (!isMountedRef.current) {
            return;
          }

          setState(nextState);
          if (nextState === 'stopped') {
            setNodeInfo(null);
          }
        },
        error: (nextError: Error) => {
          if (!isMountedRef.current) {
            return;
          }

          setError(nextError.message);
        },
      };

      nodeListenersRef.current = listeners;
      node.on('stateChange', listeners.stateChange);
      node.on('error', listeners.error);

      return node;
    },
    [detachNodeListeners, options.network, options.nodeConfig, options.wasmFactory, walletId],
  );

  const cleanupFailedStart = useCallback(
    async (node: FiberBrowserNode | null) => {
      if (!node) {
        return;
      }

      try {
        if (node.state !== 'idle' && node.state !== 'stopped') {
          await node.stop();
        }
      } catch {
        // Ignore cleanup failures after a start error.
      } finally {
        detachNodeListeners(node);
        if (nodeRef.current === node) {
          nodeRef.current = null;
        }
      }
    },
    [detachNodeListeners],
  );

  const startWithPassword = useCallback(
    async (password: string) => {
      setError(null);
      let node: FiberBrowserNode | null = null;

      try {
        const credential = new PasswordCredentialProvider(walletId);
        node = initNode(credential);
        const info = await node.start({ unlockParams: { password } });
        if (isMountedRef.current) {
          setNodeInfo(info);
        }
      } catch (startError) {
        if (isMountedRef.current) {
          setError(asErrorMessage(startError));
        }

        await cleanupFailedStart(node);
      }
    },
    [cleanupFailedStart, initNode, walletId],
  );

  const createPasskeyAndStart = useCallback(
    async (username = 'User') => {
      setError(null);
      let node: FiberBrowserNode | null = null;

      try {
        const credential = new PasskeyCredentialProvider(walletId);
        await credential.register(username);
        if (isMountedRef.current) {
          setHasPasskeyConfigured(true);
        }

        node = initNode(credential);
        const info = await node.start();
        if (isMountedRef.current) {
          setNodeInfo(info);
        }
      } catch (startError) {
        if (isMountedRef.current) {
          setError(asErrorMessage(startError));
        }

        await cleanupFailedStart(node);
      }
    },
    [cleanupFailedStart, initNode, walletId],
  );

  const startWithPasskey = useCallback(async () => {
    setError(null);
    let node: FiberBrowserNode | null = null;

    try {
      const credential = new PasskeyCredentialProvider(walletId);
      node = initNode(credential);
      const info = await node.start();
      if (isMountedRef.current) {
        setNodeInfo(info);
      }
    } catch (startError) {
      if (isMountedRef.current) {
        setError(asErrorMessage(startError));
      }

      await cleanupFailedStart(node);
    }
  }, [cleanupFailedStart, initNode, walletId]);

  const stop = useCallback(async () => {
    const node = nodeRef.current;
    if (!node) {
      return;
    }

    try {
      await node.stop();
    } catch (stopError) {
      if (isMountedRef.current) {
        setError(asErrorMessage(stopError));
      }
    } finally {
      detachNodeListeners(node);
      if (nodeRef.current === node) {
        nodeRef.current = null;
      }

      if (isMountedRef.current) {
        setNodeInfo(null);
      }
    }
  }, [detachNodeListeners]);

  return {
    state,
    node: nodeRef.current,
    nodeInfo,
    error,
    isPasskeySupported,
    passkeySupportReason,
    passkeyUnavailableReason,
    hasPasskeyConfigured,
    startWithPassword,
    createPasskeyAndStart,
    startWithPasskey,
    stop,
  };
}
