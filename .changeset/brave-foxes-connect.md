---
"@fiber-pay/react-native": patch
---

Add `@fiber-pay/react-native`, a React Native client for Fiber Network. `useFiberNode({ url })` connects to a remote `fnn` node over JSON-RPC (no WASM/IndexedDB runtime needed, unlike `@fiber-pay/react`), and `useFiberPayment(client)` creates, parses, and pays invoices.
