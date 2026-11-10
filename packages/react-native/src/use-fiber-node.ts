import { FiberRpcClient, type NodeInfoResult } from '@fiber-pay/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type FiberNodeState = 'idle' | 'connecting' | 'ready' | 'error';

// @fiber-pay/sdk's root entrypoint doesn't export `RpcClientConfig` (only
// `/browser` does), so this is derived structurally from the constructor
// instead of importing a type that isn't actually public from here.
type RemoteNodeConfig = ConstructorParameters<typeof FiberRpcClient>[0];

export interface UseFiberNodeOptions extends Omit<RemoteNodeConfig, 'url'> {
  /** RPC URL of a remote fnn node, e.g. `http://127.0.0.1:8227`. */
  url: string;
  /** Poll interval in ms for the first retry; later retries back off linearly up to `maxPollIntervalMs`. Default 2000. */
  pollIntervalMs?: number;
  /** Cap for the backed-off poll interval, in ms. Default 30000. */
  maxPollIntervalMs?: number;
  /** Consecutive failed attempts before giving up and reporting `error`. Default 5. */
  maxRetries?: number;
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

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function areHeadersEqual(prev?: Record<string, string>, next?: Record<string, string>): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const key of prevKeys) {
    if (!Object.hasOwn(next, key) || prev[key] !== next[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Connects to a remote Fiber node (`fnn`) over its JSON-RPC endpoint.
 *
 * `@fiber-pay/react`'s `useFiberNode` runs a WASM node locally in the
 * browser. React Native has no WASM + IndexedDB runtime to host that, so
 * this hook instead points `FiberRpcClient` at a remote node address and
 * polls until it answers, with a bounded number of retries.
 */
export function useFiberNode(options: UseFiberNodeOptions): UseFiberNodeResult {
  const {
    url,
    timeout,
    headers,
    biscuitToken,
    pollIntervalMs = 2000,
    maxPollIntervalMs = 30000,
    maxRetries = 5,
    enabled = true,
  } = options;

  const [state, setState] = useState<FiberNodeState>('idle');
  const [nodeInfo, setNodeInfo] = useState<NodeInfoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const headersRef = useRef(headers);
  if (!areHeadersEqual(headersRef.current, headers)) {
    headersRef.current = headers;
  }
  const stableHeaders = headersRef.current;

  const client = useMemo(() => {
    const config: RemoteNodeConfig = { url };
    if (timeout !== undefined) config.timeout = timeout;
    if (stableHeaders !== undefined) config.headers = stableHeaders;
    if (biscuitToken !== undefined) config.biscuitToken = biscuitToken;
    return new FiberRpcClient(config);
  }, [url, timeout, stableHeaders, biscuitToken]);

  // Bumped on every effect run (mount, url/config change, reconnect) and
  // again on cleanup, so a response that arrives after the effect that
  // started it has been superseded can never commit into the wrong run's
  // state. A shared boolean ref isn't enough here: the next effect run
  // would reset it before a late response from the previous run checks it.
  const runIdRef = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: generation is a deliberate re-run trigger for reconnect(), not read in the body.
  useEffect(() => {
    runIdRef.current += 1;
    const runId = runIdRef.current;
    const isCurrentRun = () => runIdRef.current === runId;

    if (!enabled) {
      setState('idle');
      setNodeInfo(null);
      setError(null);
      return;
    }

    setState('connecting');
    setNodeInfo(null);
    setError(null);

    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      while (isCurrentRun()) {
        try {
          const info = await client.nodeInfo();
          if (!isCurrentRun()) return;
          setNodeInfo(info);
          setError(null);
          setState('ready');
          return;
        } catch (pollError) {
          if (!isCurrentRun()) return;
          attempt += 1;
          setError(asErrorMessage(pollError));

          if (attempt >= maxRetries) {
            setState('error');
            return;
          }

          // ponytail: linear-capped backoff, not full exponential+jitter.
          // Bounded retries + a surfaced error already cover the "stuck
          // forever offline" failure mode; revisit the backoff curve if
          // this ever talks to a high-churn public endpoint.
          const delay = Math.min(pollIntervalMs * attempt, maxPollIntervalMs);
          await new Promise<void>((resolve) => {
            timer = setTimeout(resolve, delay);
          });
        }
      }
    };

    poll().catch((err: unknown) => {
      if (!isCurrentRun()) return;
      setError(asErrorMessage(err));
      setState('error');
    });

    return () => {
      runIdRef.current += 1;
      if (timer) clearTimeout(timer);
    };
  }, [client, enabled, pollIntervalMs, maxPollIntervalMs, maxRetries, generation]);

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
