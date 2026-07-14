# FiberNodeButton Live Preview

A deployable, component-first preview of the current `FiberNodeButton` from `@fiber-pay/react`.

The page runs a real browser Fiber node on testnet. It supports Passkey and password credentials, exposes the complete built-in management panel, and reads CKB plus the configured RUSD testnet asset from the node. No node state, balance, channel or payment is mocked.

## Workspace source

This example depends on `@fiber-pay/react` through `workspace:*`. Building from the repository root compiles the current package source before Vite bundles the preview, so a deployment tracks the exact code in its Git commit rather than an older npm release.

## Run locally

From the repository root:

```bash
pnpm install
pnpm --filter example-react-fiber-node-button-lab... build
pnpm --filter example-react-fiber-node-button-lab dev
```

Open <http://localhost:5174>.

The preview requires cross-origin isolation for threaded WASM. The Vite development and preview servers set the required headers automatically.

## Deploy with Vercel

Import the repository root as a Vercel project. The root [`vercel.json`](../../vercel.json) provides:

- the workspace-aware install and build commands;
- `examples/react-fiber-node-button-lab/dist` as the output directory;
- the COOP, COEP and CORP response headers required by Fiber WASM.

No environment variables are required for the default testnet preview.

## Safety

- Use testnet funds only.
- Passwords and credential material stay in browser storage and are not sent to the preview host.
- Passkey mode requires HTTPS or localhost and an authenticator with WebAuthn PRF support.
