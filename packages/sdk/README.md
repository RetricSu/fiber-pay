# @fiber-pay/sdk

Core SDK for building Fiber Network applications on CKB Lightning.

## Install

```bash
pnpm add @fiber-pay/sdk
```

## Usage

```ts
import { FiberRpcClient } from '@fiber-pay/sdk';

const client = new FiberRpcClient({
	url: 'http://127.0.0.1:8227',
	biscuitToken: process.env.FIBER_RPC_BISCUIT_TOKEN,
});

const info = await client.nodeInfo();
console.log(info.node_id);
```

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

The SDK includes L402 payment-gating primitives for Express APIs:

- `MacaroonService` — mint and verify L402 tokens
- `createL402Middleware()` — Express middleware for 402 challenge-response flow

See [docs/l402-agent-guide.md](../../docs/l402-agent-guide.md) for usage.

## Compatibility

- Node.js `>=20`
- Fiber target: `v0.7.1`

