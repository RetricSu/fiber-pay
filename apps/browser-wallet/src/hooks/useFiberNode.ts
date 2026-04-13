import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FiberBrowserNode,
  PasswordCredentialProvider,
  PasskeyCredentialProvider,
  type BrowserNodeState,
  type NodeInfoResult,
  type PasskeySupportStatus,
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
  passkeyUnavailableReason: string | null;
  hasPasskeyConfigured: boolean;
}

function getPasskeyUnavailableReason(status: PasskeySupportStatus): string | null {
  if (status.supported) {
    return null;
  }

  switch (status.reason) {
    case 'insecure-context':
      return 'This page is not in a secure context. Browser Passkey mode requires HTTPS or localhost.';
    case 'webauthn-unavailable':
      return 'WebAuthn is unavailable in this browser.';
    case 'prf-unsupported':
      return 'WebAuthn PRF extension is not available in this browser/authenticator.';
    case 'window-unavailable':
      return 'Passkey checks require a browser window environment.';
    default:
      return 'Browser Passkey requirements are not met in this environment.';
  }
}

export function useFiberNode(network: 'testnet' | 'mainnet'): UseFiberNodeResult {
  const [state, setState] = useState<BrowserNodeState>('idle');
  const [nodeInfo, setNodeInfo] = useState<NodeInfoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPasskeySupported, setIsPasskeySupported] = useState(false);
  const [passkeyUnavailableReason, setPasskeyUnavailableReason] = useState<string | null>(null);
  const [hasPasskeyConfigured, setHasPasskeyConfigured] = useState(false);

  const nodeRef = useRef<FiberBrowserNode | null>(null);

  useEffect(() => {
    // Check support
    PasskeyCredentialProvider.getSupportStatus()
      .then((status) => {
        setIsPasskeySupported(status.supported);
        setPasskeyUnavailableReason(getPasskeyUnavailableReason(status));
      })
      .catch(() => {
        setIsPasskeySupported(false);
        setPasskeyUnavailableReason('Unable to detect passkey capabilities in this browser.');
      });
    
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
    passkeyUnavailableReason,
    hasPasskeyConfigured,
  };
}
