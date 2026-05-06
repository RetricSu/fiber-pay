# Browser Wallet Demo Console

This app demonstrates a Fiber WASM node running fully in browser with a developer-friendly control console.

## Run

```bash
pnpm -C apps/browser-wallet dev
```

Build:

```bash
pnpm -C apps/browser-wallet build
```

## What You Can Do

After node startup, the app exposes common operational flows (similar to CLI workflows):

- Connect entry: `ConnectButton` with explicit `password` / `passkey` strategy and custom dropdown actions

- Node lifecycle: start/stop with password or passkey
- Runtime snapshot: `node_info`, `list_peers`, `list_channels`
- Peer operations: `connect_peer`, `disconnect_peer`
- Channel operations: `open_channel` + live channel list
- Invoice operations: `new_invoice`, `get_invoice`, `cancel_invoice`
- Payment operations: `send_payment`, `waitForPayment`, `get_payment`
- Network graph overview: `graph_nodes`, `graph_channels`
- Activity log: operation history with success/error detail

## Notes

- The demo targets `testnet` by default.
- Channel/invoice/payment amounts are entered in CKB in UI, and converted to shannons for RPC.
- Sensitive operations remain local to browser runtime (WASM + local credential provider).
