---
"@fiber-pay/react-native": patch
"@fiber-pay/sdk": patch
---

Fix React Native hooks and RPC client timeout, payment state, and inline headers reconnection:
- Preserve default 30s timeout in `FiberRpcClient` and `useFiberNode` when `timeout` is omitted, avoiding premature request cancellation.
- Reset payment state (`isPaying`, `paymentResult`, `error`) on client change in `useFiberPayment`, and isolate single-flight payment locks across clients.
- Stabilize inline `headers` reference in `useFiberNode` to prevent unnecessary client re-creations and reconnect loops.
