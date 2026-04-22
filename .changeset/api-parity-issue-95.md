---
"@fiber-pay/sdk": minor
---

Add shared `IFiberClient` interface for browser/RPC API parity (issue #95)

- New `IFiberClient` interface type enabling polymorphic usage of `FiberRpcClient` and `FiberBrowserNode`
- `FiberBrowserNode.nodeInfo()` added (canonical); `getNodeInfo()` deprecated
- `FiberBrowserNode.settleInvoice()` added (was missing)
- `FiberRpcClient` mutation methods now return `void` instead of `null`
- Both classes declare `implements IFiberClient`
