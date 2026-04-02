import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FiberBrowserNode,
  PasswordCredentialProvider,
  type BrowserNodeState,
  type NodeInfoResult,
} from '@fiber-pay/sdk/browser';

export interface UseFiberNodeResult {
  state: BrowserNodeState;
  nodeInfo: NodeInfoResult | null;
  error: string | null;
  start: (password: string) => Promise<void>;
  stop: () => Promise<void>;
  node: FiberBrowserNode | null;
}

export function useFiberNode(network: 'testnet' | 'mainnet'): UseFiberNodeResult {
  const [state, setState] = useState<BrowserNodeState>('idle');
  const [nodeInfo, setNodeInfo] = useState<NodeInfoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nodeRef = useRef<FiberBrowserNode | null>(null);

  useEffect(() => {
    // Create node instance on init
    const credential = new PasswordCredentialProvider('browser-wallet-demo');
    const node = new FiberBrowserNode({
      network,
      credential,
      nodeConfig: {
        databasePrefix: `/wallet-demo-${network}`,
      },
    });

    nodeRef.current = node;

    const handleStateChange = (newState: BrowserNodeState) => {
      setState(newState);
      if (newState === 'stopped') {
        setNodeInfo(null);
      }
    };

    const handleError = (err: Error) => {
      setError(err.message);
    };

    node.on('stateChange', handleStateChange);
    node.on('error', handleError);

    return () => {
      node.off('stateChange', handleStateChange);
      node.off('error', handleError);
      // We don't automatically stop on unmount to allow background running,
      // but in a real app you might want to manage this via a Context Provider.
    };
  }, [network]);

  const start = useCallback(async (password: string) => {
    if (!nodeRef.current) return;
    setError(null);
    try {
      const info = await nodeRef.current.start({ password });
      setNodeInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Reset state if it failed to start
      setState('error');
    }
  }, []);

  const stop = useCallback(async () => {
    if (!nodeRef.current) return;
    try {
      await nodeRef.current.stop();
    } catch (err) {
      console.error('Failed to stop node:', err);
    }
  }, []);

  return {
    state,
    nodeInfo,
    error,
    start,
    stop,
    node: nodeRef.current,
  };
}
