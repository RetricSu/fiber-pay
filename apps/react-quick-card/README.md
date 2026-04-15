# React Quick Card Demo

A minimal Vite + React app demonstrating the `FiberPayQuickCard` component from `@fiber-pay/react`.

## Run

```bash
pnpm -C apps/react-quick-card dev
```

Then open `http://localhost:5174`.

## What it demonstrates

- One-line integration: `import { FiberPayQuickCard } from '@fiber-pay/react'`
- Node startup with password or passkey
- Create invoice and pay invoice directly in the card UI
- Event hooks: `onInvoiceCreated`, `onPaymentResult`, `onError`

## Notes

- Cross-Origin Isolation headers are enabled in `vite.config.ts` for SharedArrayBuffer (required by the browser WASM node).
- This demo targets `testnet` by default.
