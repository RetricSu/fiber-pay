# SDK Node Recipes

Layer: Universal SDK layer (@fiber-pay/sdk)

Audience:

- Developers writing Node scripts, workers, and automation around Fiber RPC.

You will learn:

1. Initialize FiberRpcClient with configurable RPC URL.
2. Compose common payment/channel recipes in standalone scripts.
3. Use waitForPayment and waitForChannelReady in robust flows.
4. Use watchIncomingPayments with AbortController for graceful watcher shutdown.

Out of scope:

1. Browser WASM lifecycle and passkey UX.
2. React hooks and component integration.
3. Browser-only helper utilities.

## Prerequisites

1. Running Fiber node (local or remote).
2. Testnet CKB and at least one ready channel for payment recipes.
3. Repo dependencies installed from workspace root.

## Run

```bash
# Basic payment flow
pnpm -C examples/sdk-node-recipes basic-payment

# Hold invoice (escrow pattern)
pnpm -C examples/sdk-node-recipes hold-invoice

# Open -> ready -> close channel lifecycle
pnpm -C examples/sdk-node-recipes channel-lifecycle

# Watch incoming payments until aborted
pnpm -C examples/sdk-node-recipes watch-incoming
```

Or run directly with environment override:

```bash
FIBER_RPC_URL=http://127.0.0.1:8227 pnpm -C examples/sdk-node-recipes basic-payment
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| FIBER_RPC_URL | http://127.0.0.1:8227 | Fiber JSON-RPC endpoint |
| PEER_ADDR | (built-in testnet bootnode in channel-lifecycle.ts) | Target peer address |
| PEER_PUBKEY | (auto-discovered in channel-lifecycle.ts) | Target peer pubkey override |

## Recipes

- basic-payment.ts
- hold-invoice.ts
- channel-lifecycle.ts
- watch-incoming.ts

## Next Step

If you need browser-side SDK usage (without React wrappers), continue to examples/browser-sdk-playground.
