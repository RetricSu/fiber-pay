# @fiber-pay/sdk

Core SDK for building Fiber Network applications on CKB Lightning.

## Install

```bash
pnpm add @fiber-pay/sdk
```

## Entrypoints

- `@fiber-pay/sdk` - Universal APIs (browser-safe)
- `@fiber-pay/sdk/browser` - Browser WASM node and browser credential providers
- `@fiber-pay/sdk/node` - Node-focused APIs, including L402 middleware utilities

## Usage

```ts
import { FiberRpcClient } from '@fiber-pay/sdk';

const client = new FiberRpcClient({
  url: 'http://127.0.0.1:8227',
  biscuitToken: process.env.FIBER_RPC_BISCUIT_TOKEN,
});

const info = await client.nodeInfo();
console.log(info.pubkey);
```

## Browser Usage

Use the browser subpath in frontend apps to avoid pulling Node-only modules:

```ts
import { BrowserRpcClient } from '@fiber-pay/sdk/browser';

const client = new BrowserRpcClient({
  url: 'http://127.0.0.1:8227',
});

const info = await client.nodeInfo();
console.log(info.pubkey);
```

`@fiber-pay/sdk/browser` also exports `FiberRpcClient` for migration compatibility.

## RPC Authentication (Biscuit)

- Pass `biscuitToken` to `new FiberRpcClient(...)`.
- SDK sends `Authorization: Bearer <token>` on every JSON-RPC request.
- Keep tokens on trusted backend/server side; avoid embedding privileged tokens in browser bundles.

Generate token-side permission facts from RPC methods:

```ts
import { renderBiscuitFactsForMethods } from '@fiber-pay/sdk';

const facts = renderBiscuitFactsForMethods([
  'list_peers',
  'send_payment',
  'get_payment',
]);

console.log(facts);
// read("payments");
// read("peers");
// write("payments");
```

This helper aligns with upstream Fiber Biscuit permission mapping (method -> read/write resource),
and can be used to prepare `permissions.bc` inputs before signing tokens.

## L402 Protocol

Use the Node entrypoint for L402 payment-gating primitives:

```ts
import {
  createL402Middleware,
  FiberRpcClient,
  MacaroonService,
} from '@fiber-pay/sdk/node';
```

Node entry includes the same universal APIs as root, plus L402 server helpers.

L402 primitives include:

- `MacaroonService` — mint and verify L402 tokens
- `createL402Middleware()` — Express middleware for 402 challenge-response flow

See [docs/l402-agent-guide.md](../../docs/l402-agent-guide.md) for usage.

## Compatibility

- Node.js `>=20`
- Fiber target: `v0.8.0`
