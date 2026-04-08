import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FiberBrowserNode,
  PasswordCredentialProvider,
  PasskeyCredentialProvider,
  type BrowserNodeState,
  type NodeInfoResult,
} from '@fiber-pay/sdk/browser';

export interface UseFiberNodeResult {
  network: 'testnet' | 'mainnet';
  state: BrowserNodeState;
  nodeInfo: NodeInfoResult | null;
  error: string | null;
  startWithPassword: (password: string) => Promise<void>;
  startWithPasskey: () => Promise<void>;
  createPasskey: (username: string) => Promise<void>;
  stop: () => Promise<void>;
  node: FiberBrowserNode | null;
  isPasskeySupported: boolean;
  hasPasskeyConfigured: boolean;
}

export function useFiberNode(network: 'testnet' | 'mainnet'): UseFiberNodeResult {
  const [state, setState] = useState<BrowserNodeState>('idle');
  const [nodeInfo, setNodeInfo] = useState<NodeInfoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPasskeySupported, setIsPasskeySupported] = useState(false);
  const [hasPasskeyConfigured, setHasPasskeyConfigured] = useState(false);

  const nodeRef = useRef<FiberBrowserNode | null>(null);

  useEffect(() => {
    // Check support
    PasskeyCredentialProvider.isSupported().then(setIsPasskeySupported).catch(() => {});
    
    // Check if configured
    const pkProvider = new PasskeyCredentialProvider(`wallet-demo-${network}`);
    setHasPasskeyConfigured(pkProvider.isConfigured());
  }, [network]);

  const initNode = useCallback((provider: PasswordCredentialProvider | PasskeyCredentialProvider) => {
    if (nodeRef.current) {
      if (nodeRef.current.state !== 'stopped' && nodeRef.current.state !== 'idle') {
         throw new Error('Node already running');
      }
    }

    const node = new FiberBrowserNode({
      network,
      credential: provider,
      nodeConfig: {
        databasePrefix: `/wallet-demo-${network}`,
      },
    });

    nodeRef.current = node;

    node.on('stateChange', (newState) => {
      setState(newState);
      if (newState === 'stopped') {
        setNodeInfo(null);
      }
    });

    node.on('error', (err: Error) => {
      setError(err.message);
    });

    return node;
  }, [network]);

  const startWithPassword = useCallback(async (password: string) => {
    setError(null);
    try {
      const provider = new PasswordCredentialProvider(`wallet-demo-${network}`);
      const node = initNode(provider);
      const info = await node.start({ unlockParams: { password } });
      setNodeInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, [initNode, network]);

  const startWithPasskey = useCallback(async () => {
    setError(null);
    try {
      const provider = new PasskeyCredentialProvider(`wallet-demo-${network}`);
      const node = initNode(provider);
      const info = await node.start(); // Unlock params not needed for existing passkey
      setNodeInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, [initNode, network]);

  const createPasskey = useCallback(async (username: string) => {
    setError(null);
    try {
      const provider = new PasskeyCredentialProvider(`wallet-demo-${network}`);
      await provider.register(username);
      setHasPasskeyConfigured(true);
      
      const node = initNode(provider);
      const info = await node.start();
      setNodeInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, [initNode, network]);

  const stop = useCallback(async () => {
    if (!nodeRef.current) return;
    try {
      await nodeRef.current.stop();
    } catch (err) {
      console.error('Failed to stop node:', err);
    }
  }, []);

  return {
    network,
    state,
    nodeInfo,
    error,
    startWithPassword,
    startWithPasskey,
    createPasskey,
    stop,
    node: nodeRef.current,
    isPasskeySupported,
    hasPasskeyConfigured,
  };
}
