# Auth (Biscuit) Guide

This guide documents how `fiber-pay` works with Fiber RPC Biscuit authentication.

Upstream reference:

- Fiber Biscuit auth doc: [docs/biscuit-auth.md](https://github.com/nervosnetwork/fiber/blob/v0.7.1/docs/biscuit-auth.md)
- Fiber RPC reference: [crates/fiber-lib/src/rpc/README.md](https://github.com/nervosnetwork/fiber/blob/v0.7.1/crates/fiber-lib/src/rpc/README.md)

## Scope

- **Server side (Fiber node):** verify Biscuit token using `rpc.biscuit_public_key`.
- **Client side (fiber-pay CLI / SDK):** attach `Authorization: Bearer <token>` for RPC calls.
- **Policy side:** generate token permissions (`read("...")` / `write("...")`) matching RPC methods.

## 1) Enable Biscuit on Fiber node

Set public key in node config (`config.yml`):

```yaml
rpc:
  listening_addr: "127.0.0.1:8227"
  biscuit_public_key: "ed25519/<public-key>"
```

Related config key reference: see `references/config.md` (`rpc.biscuit_public_key`).

## 2) CLI usage

`fiber-pay` supports auth token through either:

- CLI flag: `--rpc-biscuit-token <token>`
- Env var: `FIBER_RPC_BISCUIT_TOKEN`

Example:

```bash
fiber-pay --rpc-biscuit-token "$TOKEN" node status --json
```

or

```bash
export FIBER_RPC_BISCUIT_TOKEN="$TOKEN"
fiber-pay node status --json
```

Resolution priority:

1. `--rpc-biscuit-token`
2. `FIBER_RPC_BISCUIT_TOKEN`
3. unset (no auth header)

## 3) SDK usage

Use `biscuitToken` when creating RPC client:

```ts
import { FiberRpcClient } from '@fiber-pay/sdk';

const client = new FiberRpcClient({
  url: 'http://127.0.0.1:8227',
  biscuitToken: process.env.FIBER_RPC_BISCUIT_TOKEN,
});
```

SDK will send:

```http
Authorization: Bearer <token>
```

## 4) Token permission template (method -> permission)

SDK provides helper to align with upstream Biscuit method-policy model:

```ts
import { renderBiscuitFactsForMethods } from '@fiber-pay/sdk';

const facts = renderBiscuitFactsForMethods([
  'list_peers',
  'send_payment',
  'get_payment',
]);

// read("payments");
// read("peers");
// write("payments");
```

This output can be used as input content for signing Biscuit tokens (e.g. in `permissions.bc`).

## 5) Operational notes

- Prefer short-lived tokens and least privilege permissions.
- Avoid embedding privileged long-lived tokens into browser bundles.
- For public RPC listening addresses, ensure Biscuit auth is enabled.
