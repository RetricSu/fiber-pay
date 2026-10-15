# @fiber-pay/react-native

React Native hooks for Fiber Network payments.

## Why this package exists

`@fiber-pay/react` runs a Fiber node locally in the browser via WASM. React
Native has no WASM + IndexedDB runtime to host that, so this package takes a
different approach: it connects to a **remote** `fnn` node over its JSON-RPC
endpoint using `FiberRpcClient` from `@fiber-pay/sdk`, which has no
browser-only or Node-only dependencies and works with React Native's global
`fetch`.

## Status

Milestone 1 (connect to a remote node):

- `useFiberNode({ url })` — polls a remote `fnn` node's JSON-RPC endpoint
  until reachable, exposes `nodeInfo`, connection `state`, and a `client`
  (`FiberRpcClient`) for further calls.

Payment/invoice hooks (`useFiberPayment` and friends) land in a later
milestone.

## Usage

```tsx
import { useFiberNode } from '@fiber-pay/react-native';

function App() {
  const { state, nodeInfo, error } = useFiberNode({
    url: 'http://127.0.0.1:8227',
  });

  if (state === 'connecting') return <Text>Connecting…</Text>;
  if (state === 'error') return <Text>Error: {error}</Text>;
  return <Text>Connected to {nodeInfo?.version}</Text>;
}
```
