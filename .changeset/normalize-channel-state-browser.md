---
'@fiber-pay/sdk': patch
'@fiber-pay/react': patch
'@fiber-pay/node': patch
'@fiber-pay/runtime': patch
'@fiber-pay/cli': patch
'@fiber-pay/agent': patch
---

fix(sdk): normalize channel `state.state_name` on the browser/WASM path so it
matches the `ChannelState` enum (SCREAMING_SNAKE_CASE) returned by the RPC
client. This fixes `FiberBrowserNode.waitForChannelReady` and any consumer that
compares `channel.state.state_name === ChannelState.ChannelReady` on the
browser path.

Internal: extracted `normalizeChannel` / `normalizeChannelStateName` from
`FiberRpcClient` into a shared `rpc/normalize-channel` module used by both the
RPC client and the WASM adapter.
