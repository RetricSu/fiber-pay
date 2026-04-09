# SDK Entrypoint Migration: issue #87

Date: 2026-04-09

## Background

To keep frontend usage safe by default, `@fiber-pay/sdk` now separates Node-only APIs from universal/browser-safe APIs.

Before this change, root entry (`@fiber-pay/sdk`) also exported L402 middleware/server helpers, which can pull Node-only dependencies into browser bundling paths by mistake.

## What Changed

- Added a new Node subpath export: `@fiber-pay/sdk/node`
- Root entry `@fiber-pay/sdk` is now universal/browser-safe focused
- L402 server APIs moved to `@fiber-pay/sdk/node`

Node-only APIs moved behind `@fiber-pay/sdk/node` include:

- `createL402Middleware`
- `L402Middleware`
- `MacaroonService`
- `DefaultResourceResolverRegistry`
- Related L402 types

## Migration Guide

### 1) Update imports for L402/server APIs

Before:

```ts
import { createL402Middleware, MacaroonService } from '@fiber-pay/sdk';
```

After:

```ts
import { createL402Middleware, MacaroonService } from '@fiber-pay/sdk/node';
```

### 2) Keep universal APIs on root entry

No change needed for universal APIs such as:

- `FiberRpcClient`
- `FiberRpcError`
- RPC types
- conversion and utility helpers

Example:

```ts
import { FiberRpcClient, ckbToShannons } from '@fiber-pay/sdk';
```

### 3) Browser projects should continue using browser entry

Use:

```ts
import { FiberBrowserNode, BrowserRpcClient } from '@fiber-pay/sdk/browser';
```

Do not import Node-only L402 APIs in browser bundles.

## Why This Improves DX

- Clearer import intent: universal vs browser vs node
- Lower chance of accidentally bundling Node-only modules into frontend apps
- More predictable package behavior for tooling and bundlers

## Validation Checklist

- Build passes for SDK and CLI
- Lint/typecheck/tests pass
- Export-boundary regression test confirms:
  - root and browser do not expose Node-only L402 exports
  - node entry does expose L402 exports

## FAQ

### Is this a breaking change?

Yes for consumers importing L402 APIs from `@fiber-pay/sdk` root. Update those imports to `@fiber-pay/sdk/node`.

### Do I need to change browser code from issue #91?

No. Browser RPC client usage via `@fiber-pay/sdk/browser` stays compatible.
