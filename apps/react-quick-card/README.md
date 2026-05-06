# React SDK Demo (ConnectButton + QuickCard)

A Vite + React app demonstrating both `ConnectButton` and `FiberPayQuickCard` from `@fiber-pay/react`.

## Run

```bash
pnpm -C apps/react-quick-card dev
```

Then open `http://localhost:5174`.

## What it demonstrates

- `ConnectButton` integration in external-hook mode via `useFiberNode`
- Password-based connect/disconnect flow with a custom connected dropdown
- Event callback wiring for connect/disconnect/error and quick log output
- `FiberPayQuickCard` one-line integration and payment callbacks

## Notes

- Cross-Origin Isolation headers are enabled in `vite.config.ts` for SharedArrayBuffer (required by the browser WASM node).
- This demo targets `testnet` by default.
