# React SDK Demo (FiberNodeButton + QuickCard)

A Vite + React app demonstrating `FiberNodeButton` and `FiberPayQuickCard` from `@fiber-pay/react`.

## Run

```bash
pnpm -C apps/react-quick-card dev
```

Then open `http://localhost:5174`.

## What it demonstrates

- Step-by-step connection lifecycle with `useFiberNode` + `FiberNodeButton`
- `FiberNodeButton` default wallet-style dropdown sections: connection state/actions, channel management, payment management, optional connector block
- Explicit strategy selection (`password` or `passkey`) and live hook status visibility
- External wallet funding mode toggle with CCC signer integration
- Peer management + channel open flow (`list_peers`, `connect_peer`, `open_channel`)
- `FiberPayQuickCard` reusing the same connected node session via the `fiber` prop

## Suggested walkthrough

1. Choose a connection strategy in section 1.
2. Connect the node and verify status changes to `running`.
3. Open `FiberNodeButton` dropdown and try channel / payment actions.
4. (Optional) enable external wallet mode and connect CCC signer.
5. Compare with the legacy `FiberPayQuickCard` block.

## Notes

- Cross-Origin Isolation headers are enabled in `vite.config.ts` for SharedArrayBuffer (required by the browser WASM node).
- This demo targets `testnet` by default.
