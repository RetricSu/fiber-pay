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

### CCC External Funding Resolver (React-Friendly)

For external wallet channel funding in React UIs (for example `FiberNodeButton`),
you can use a prebuilt CCC resolver factory instead of wiring scripts/deps manually.

```ts
import { ccc } from '@ckb-ccc/connector-react';
import { createCccExternalFundingResolver } from '@fiber-pay/sdk/browser';

const resolveExternalFunding = createCccExternalFundingResolver({
  signer: cccSigner,
  knownScripts: Object.values(ccc.KnownScript),
  ckbRpcUrl: 'https://testnet.ckbapp.dev/',
});

// FiberNodeButton externalFunding usage
const externalFunding = {
  enabled: true,
  resolve: resolveExternalFunding,
};
```

## Browser Usage

Browser integrations also need the Fiber WASM runtime peer dependency:

```bash
pnpm add @fiber-pay/sdk @nervosnetwork/fiber-js
```

Use the browser subpath in frontend apps to avoid pulling Node-only modules:

```ts
import { BrowserRpcClient } from '@fiber-pay/sdk/browser';

const client = new BrowserRpcClient({
  url: 'http://127.0.0.1:8227',
});

const info = await client.nodeInfo();
console.log(info.pubkey);
```

### Browser Runtime Requirements

For multithreaded WASM runtime support (`SharedArrayBuffer`), serve the app with:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Without these headers, browser node startup can fail at runtime.

In production deployments, configure these headers at your hosting layer (for example
Nginx, Cloudflare, or Vercel), not only in local dev tooling.

### Bundle Size Expectations

The Fiber browser runtime is intentionally heavy. Expect a large WASM-related chunk in production builds
(roughly ~14 MB raw and ~6.5 MB gzip in current examples). Prefer route-level code splitting and lazy
mounting so the chunk loads only when payment/node features are needed.

`@fiber-pay/sdk/browser` also exports `FiberRpcClient` for migration compatibility.

If you want one-line React imports (hooks + starter component), use:

```ts
import { FiberPayQuickCard, useFiberNode, useFiberPayment } from '@fiber-pay/react';
```

For a frontend-first quickstart (WASM + Passkey + minimal React payment component), see:

- [packages/react/docs/wasm-passkey-payment-component-quickstart.md](../react/docs/wasm-passkey-payment-component-quickstart.md)

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

See [packages/cli/docs/l402-agent-guide.md](../cli/docs/l402-agent-guide.md) for usage.

## UDT (User-Defined Token) Support

The SDK provides typed UDT helpers for parsing, formatting, and resolving UDT assets:

```ts
import {
  parseUdtTypeScript,
  validateUdtTypeScript,
  resolveUdtAsset,
  parseFundingAmount,
  parsePaymentAmount,
  formatChannelBalances,
  formatAssetName,
  DEFAULT_CKB_ASSET,
} from '@fiber-pay/sdk';
// Also available from '@fiber-pay/sdk/browser'
```

### UDT Types

| Type | Description |
|------|-------------|
| `UdtAsset` | Union type: `{ kind: 'ckb' }` or `{ kind: 'udt'; script: UdtTypeScript; name?: string }` |
| `UdtTypeScript` | CKB type script `{ code_hash, hash_type, args }` |
| `FormattedChannelBalances` | Display-ready balance fields with `kind: 'ckb'` or `kind: 'udt'` |

### Common UDT Workflows

**Parsing user input** — safely convert CLI/browser input into validated types:
```ts
const script = parseUdtTypeScript(rawJson, '--udt-type-script');
// or validate an already-parsed object:
validateUdtTypeScript(obj, '--udt-type-script');

const fundingAmount = parseFundingAmount('1000', { kind: 'udt', script, name: 'TEST' });
const paymentAmount = parsePaymentAmount('500', { kind: 'udt', script });
```

**Resolving by name** — look up configured UDTs from node info:
```ts
const asset = await resolveUdtAsset({
  name: 'RUSD',
  rpc: client,
});
// asset = { kind: 'udt', script: {...}, name: 'RUSD' }
```

**Formatting channels** — handle both CKB and UDT channels in display code:
```ts
const balances = formatChannelBalances(channel);
if (balances.kind === 'udt') {
  console.log(`UDT: local ${balances.local}, remote ${balances.remote}`);
} else {
  console.log(`CKB: local ${balances.local}, remote ${balances.remote}`);
}
```

## Compatibility

- Node.js `>=20`
- Fiber target: `v0.9.0-rc7`
