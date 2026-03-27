# L402 & Agent Service

fiber-pay supports L402 payment-gated APIs and paid AI agent services.

## SDK: L402 Module

`@fiber-pay/sdk` exports L402 primitives:

- `MacaroonService` — mint/verify L402 tokens with configurable caveats
- `createL402Middleware(config)` — Express middleware for 402 challenge-response
- `DefaultResourceResolverRegistry` — route-based resource resolver

Key config for `createL402Middleware`:

```ts
{
  rootKey: string,        // 32-byte hex (or L402_ROOT_KEY env)
  priceCkb: number,       // price per request
  expirySeconds: number,  // token validity
  rpcClient: FiberRpcClient,
  currency: 'Fibt' | 'Fibb',
}
```

## CLI: l402 proxy

Reverse proxy with L402 payment gate. Forwards paid requests to `--target`.

```bash
fiber-pay l402 proxy --target http://localhost:3000 --price 0.1 --root-key <hex>
```

Key flags: `--port` (default 8402), `--host`, `--expiry`, `--json`.

## CLI: agent serve

HTTP service that invokes a local AI agent via [acpx](https://github.com/openclaw/acpx), gated behind L402 payment.

```bash
fiber-pay agent serve --agent codex --price 0.1 --root-key <hex> --approve-all
```

- Endpoint: `POST /` with `{"prompt": "..."}`
- Requires: `npm install -g acpx` and the target agent installed
- Agents: any acpx-compatible — `codex`, `claude`, `opencode`, `gemini`, `pi`, etc.

Key flags: `--port`, `--cwd`, `--timeout`, `--approve-all`.

## CLI: agent call

Call a remote `agent serve` with automatic L402 payment via Fiber.

```bash
fiber-pay agent call http://host:8402 --prompt "explain the code"
```

Flow: send prompt → receive 402 → pay invoice → retry with token → return response.

Prompt sources: `--prompt <text>`, `--file <path>`, or piped stdin.

## Multi-node example

```bash
# Node A: serve
fiber-pay agent serve --agent opencode --price 0.1 --root-key $(openssl rand -hex 32)

# Node B: call and pay
fiber-pay --profile user agent call http://127.0.0.1:8402 --prompt "say hello"
```
