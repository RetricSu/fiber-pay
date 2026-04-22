# L402 & Agent Service Guide

This guide covers two features:

1. **L402 SDK module** — build L402-gated APIs using `@fiber-pay/sdk/node`
2. **CLI agent commands** — one-command paid AI agent services

If you are integrating `agent serve` from an external frontend or app project,
see [agent-serve-frontend-integration.md](./agent-serve-frontend-integration.md)
for migration and security guidance.

## Prerequisites

- A running Fiber node (`fiber-pay node start`)
- For agent commands: [acpx](https://github.com/openclaw/acpx) installed globally (`npm install -g acpx`)

## L402 SDK Module

The SDK includes L402 protocol primitives for building payment-gated APIs:

```ts
import {
  createL402Middleware,
  MacaroonService,
  FiberRpcClient,
} from '@fiber-pay/sdk/node';
```

### MacaroonService

Mint and verify L402 tokens:

```ts
const macaroon = new MacaroonService(process.env.L402_ROOT_KEY);

// Mint a token
const { macaroon: token, caveats } = macaroon.mint({
  identifier: 'req-1',
  paymentHash: '0x...',
  expirySeconds: 3600,
});

// Verify with preimage
const result = macaroon.verify(token, preimage);
// result.valid, result.caveats
```

### createL402Middleware

Express middleware that gates routes behind Fiber Lightning payments:

```ts
import express from 'express';

const app = express();
app.use(createL402Middleware({
  rootKey: process.env.L402_ROOT_KEY,
  priceCkb: 0.1,
  expirySeconds: 3600,
  rpcClient: new FiberRpcClient({ url: 'http://127.0.0.1:8227' }),
  currency: 'Fibt',
}));

app.get('/data', (req, res) => {
  res.json({ content: 'paid content' });
});
```

Unauthenticated requests receive `402` with a macaroon + Fiber invoice. After payment, clients include the L402 token in `Authorization` header.

## CLI: L402 Proxy

Start a reverse proxy that gates all requests behind L402 payment:

```bash
fiber-pay l402 proxy \
  --target http://localhost:3000 \
  --price 0.1 \
  --root-key $(openssl rand -hex 32)
```

Options: `--port`, `--host`, `--expiry`, `--json`. Run `fiber-pay l402 proxy -h` for details.

## CLI: Agent Service

### agent serve

Expose a local AI agent (via [acpx](https://github.com/openclaw/acpx)) as a paid HTTP service:

```bash
fiber-pay agent serve \
  --agent codex \
  --price 0.1 \
  --root-key $(openssl rand -hex 32) \
  --approve-all
```

This starts an HTTP server on the default port `:8402` (configurable via `--port`) with:

- `POST /` — accepts `{"prompt": "..."}` for a new server-issued session, or
  `{"prompt": "...", "sessionId": "...", "sessionToken": "..."}` to resume
- L402 payment gate — every request requires payment before the agent runs

Session contract:

- Server always returns `session: { id, token, created }` in JSON responses.
- Reusing a session requires both `sessionId` and `sessionToken`.
- Requests that send only one of the two fields are rejected.

Supported agents: any [acpx-compatible agent](https://github.com/openclaw/acpx) — `codex`, `claude`, `opencode`, `gemini`, `pi`, etc.

### agent call

Call a remote `agent serve` endpoint with automatic L402 payment:

```bash
# Pay and call in one step
fiber-pay agent call http://host:8402 --prompt "explain the auth module"

# From file or stdin
fiber-pay agent call http://host:8402 --file question.txt
echo "review this" | fiber-pay agent call http://host:8402
```

The call flow is fully automatic:

1. Sends prompt → receives 402 challenge
2. Pays the Fiber invoice
3. Retries with L402 token → returns agent response

### Multi-node example

```bash
# Terminal 1: serve on default node
fiber-pay agent serve --agent opencode --price 0.1 \
  --root-key $(openssl rand -hex 32)

# Terminal 2: call from another node
fiber-pay --profile user agent call http://127.0.0.1:8402 \
  --prompt "say hello"
```
