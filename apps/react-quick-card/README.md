# React SDK Demo (FiberNodeButton)

A Vite + React app focused on onboarding developers to `FiberNodeButton` from `@fiber-pay/react`.

## Run

```bash
pnpm -C apps/react-quick-card dev
```

Then open `http://localhost:5174`.

## What it demonstrates

- Step-by-step connection lifecycle with `useFiberNode` + `FiberNodeButton`
- `FiberNodeButton` tabbed dropdown panel with global status + task-oriented tabs (`Workbench`, `Channels`, `Diagnostics`)
- Explicit strategy selection (`password` or `passkey`) and live hook status visibility
- External wallet funding mode toggle with CCC signer integration
- Peer management + channel open flow + diagnostics (`list_peers`, `connect_peer`, `open_channel`, graph snapshot)
- Integration guide section with copyable wiring snippet and runtime callback logs

## Suggested walkthrough

1. Choose a connection strategy (`password` or `passkey`) in the Live Playground.
2. Connect the node and verify hook state plus event logs update.
3. Open the `FiberNodeButton` dropdown and run Workbench -> Channels -> Diagnostics flow.
4. (Optional) enable external wallet mode and connect CCC signer.
5. Copy the Integration Guide code block into your app and replace session/wallet details.

## Notes

- Cross-Origin Isolation headers are enabled in `vite.config.ts` for SharedArrayBuffer (required by the browser WASM node).
- This demo targets `testnet` by default.
