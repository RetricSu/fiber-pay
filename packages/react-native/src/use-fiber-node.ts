import { FiberRpcClient, type NodeInfoResult } from '@fiber-pay/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type FiberNodeState = 'idle' | 'connecting' | 'ready' | 'error';

export interface UseFiberNodeOptions {
  /** RPC URL of a remote fnn node, e.g. `http://127.0.0.1:8227`. */
  url: string;
  /** Poll interval in ms while waiting for the node to become reachable. */
  pollIntervalMs?: number;
  /** If false, the hook does not attempt to connect. */
  enabled?: boolean;
}

export interface UseFiberNodeResult {
  state: FiberNodeState;
  client: FiberRpcClient | null;
  nodeInfo: NodeInfoResult | null;
  error: string | null;
  isReady: boolean;
  reconnect: () => void;
}

/**
 * Connects to a remote Fiber node (`fnn`) over its JSON-RPC endpoint.
 *
 * `@fiber-pay/react`'s `useFiberNode` runs a WASM node locally in the
 * browser. React Native has no WASM + IndexedDB runtime to host that, so
 * this hook instead points `FiberRpcClient` at a remote node address and
 * polls until it answers.
 */
export function useFiberNode(options: UseFiberNodeOptions): UseFiberNodeResult {
  const { url, pollIntervalMs = 2000, enabled = true } = options;

  const [state, setState] = useState<FiberNodeState>('idle');
  const [nodeInfo, setNodeInfo] = useState<NodeInfoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const client = useMemo(() => new FiberRpcClient({ url }), [url]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setState('idle');
      return;
    }

    cancelledRef.current = false;
    setState('connecting');
    setError(null);

    // ponytail: fixed-interval polling, no exponential backoff. Fine for a
    // dev/demo loop against one known node; add backoff + a retry ceiling
    // before this talks to untrusted/public endpoints.
    const poll = async () => {
      while (!cancelledRef.current) {
        try {
          const info = await client.nodeInfo();
          if (cancelledRef.current) return;
          setNodeInfo(info);
          setState('ready');
          return;
        } catch {
          if (cancelledRef.current) return;
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      }
    };

    poll().catch((err: unknown) => {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [client, enabled, pollIntervalMs, generation]);

  const reconnect = useCallback(() => {
    setGeneration((g) => g + 1);
  }, []);

  return {
    state,
    client: enabled ? client : null,
    nodeInfo,
    error,
    isReady: state === 'ready',
    reconnect,
  };
}
