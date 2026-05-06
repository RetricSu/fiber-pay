# React SDK Demo (ConnectButton + QuickCard)

A Vite + React app demonstrating both `ConnectButton` and `FiberPayQuickCard` from `@fiber-pay/react`.

## Run

```bash
pnpm -C apps/react-quick-card dev
```

Then open `http://localhost:5174`.

## What it demonstrates

- Step-by-step connection lifecycle with `useFiberNode` + `ConnectButton`
- Direct source-code links for core SDK/demo files from inside the page
- Explicit strategy selection (`password` or `passkey`) and live hook status visibility
- UI customization showcase for `ConnectButton` (`style`, `dropdownStyle`, `renderConnectedDropdown`)
- Runtime verification actions (`node_info`, `list_peers`, `list_channels`) after connect
- `FiberPayQuickCard` as a standalone fast-MVP payment UI with callback wiring

## Suggested walkthrough

1. Choose a connection strategy in section 1.
2. Connect the node and verify status changes to `running`.
3. Click "Read runtime snapshot" to confirm RPC calls are working.
4. Try section 2 to validate quick payment UI integration.

## Notes

- Cross-Origin Isolation headers are enabled in `vite.config.ts` for SharedArrayBuffer (required by the browser WASM node).
- This demo targets `testnet` by default.
