import {
  type BrowserNodeState,
  FiberBrowserNode,
  type FiberBrowserNodeConfig,
  type FiberWasmFactory,
  type NodeInfoResult,
  PasskeyCredentialProvider,
  PasswordCredentialProvider,
} from '@fiber-pay/sdk/browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDefaultWasmFactory } from './wasm-factory.js';

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
  hasPasskeyConfigured: boolean;
  startWithPassword: (password: string) => Promise<void>;
  createPasskeyAndStart: (username?: string) => Promise<void>;
  startWithPasskey: () => Promise<void>;
  stop: () => Promise<void>;
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function useFiberNode(options: UseFiberNodeOptions): UseFiberNodeResult {
  const walletId = options.walletId ?? `wallet-${options.network}`;
  const [state, setState] = useState<BrowserNodeState>('idle');
  const [nodeInfo, setNodeInfo] = useState<NodeInfoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPasskeySupported, setIsPasskeySupported] = useState(false);
  const [hasPasskeyConfigured, setHasPasskeyConfigured] = useState(false);

  const nodeRef = useRef<FiberBrowserNode | null>(null);
  const defaultFactory = useMemo(() => createDefaultWasmFactory(), []);

  useEffect(() => {
    let cancelled = false;

    PasskeyCredentialProvider.isSupported()
      .then((supported) => {
        if (!cancelled) {
          setIsPasskeySupported(supported);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsPasskeySupported(false);
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
      if (
        nodeRef.current &&
        nodeRef.current.state !== 'idle' &&
        nodeRef.current.state !== 'stopped'
      ) {
        throw new Error('Node already running');
      }

      const node = new FiberBrowserNode({
        network: options.network,
        credential,
        wasmFactory: options.wasmFactory ?? defaultFactory,
        nodeConfig: {
          databasePrefix: `/${walletId}`,
          ...(options.nodeConfig ?? {}),
        },
      });

      nodeRef.current = node;
      node.on('stateChange', (nextState) => {
        setState(nextState);
        if (nextState === 'stopped') {
          setNodeInfo(null);
        }
      });
      node.on('error', (nextError: Error) => {
        setError(nextError.message);
      });

      return node;
    },
    [defaultFactory, options.network, options.nodeConfig, options.wasmFactory, walletId],
  );

  const startWithPassword = useCallback(
    async (password: string) => {
      setError(null);
      try {
        const credential = new PasswordCredentialProvider(walletId);
        const node = initNode(credential);
        const info = await node.start({ unlockParams: { password } });
        setNodeInfo(info);
      } catch (startError) {
        setError(asErrorMessage(startError));
        setState('error');
      }
    },
    [initNode, walletId],
  );

  const createPasskeyAndStart = useCallback(
    async (username = 'User') => {
      setError(null);
      try {
        const credential = new PasskeyCredentialProvider(walletId);
        await credential.register(username);
        setHasPasskeyConfigured(true);

        const node = initNode(credential);
        const info = await node.start();
        setNodeInfo(info);
      } catch (startError) {
        setError(asErrorMessage(startError));
        setState('error');
      }
    },
    [initNode, walletId],
  );

  const startWithPasskey = useCallback(async () => {
    setError(null);
    try {
      const credential = new PasskeyCredentialProvider(walletId);
      const node = initNode(credential);
      const info = await node.start();
      setNodeInfo(info);
    } catch (startError) {
      setError(asErrorMessage(startError));
      setState('error');
    }
  }, [initNode, walletId]);

  const stop = useCallback(async () => {
    if (!nodeRef.current) {
      return;
    }
    try {
      await nodeRef.current.stop();
    } catch (stopError) {
      setError(asErrorMessage(stopError));
    }
  }, []);

  return {
    state,
    node: nodeRef.current,
    nodeInfo,
    error,
    isPasskeySupported,
    hasPasskeyConfigured,
    startWithPassword,
    createPasskeyAndStart,
    startWithPasskey,
    stop,
  };
}
