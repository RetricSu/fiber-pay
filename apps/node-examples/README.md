# Node Examples

Runnable TypeScript examples demonstrating common Fiber Network payment flows.

These examples use `@fiber-pay/sdk` and target Node.js / CLI environments.

## Prerequisites

1. **Running Fiber node** — Either start one via `fiber-pay node start` or connect to an existing node
2. **Testnet CKB** — Get testnet CKB from the [faucet](https://faucet.nervos.org)
3. **Open channel** — At least one channel in `ChannelReady` state
4. **Dependencies built** — Run `pnpm build` from the repo root

## Running Examples

```bash
# From the repo root
npx tsx apps/node-examples/basic-payment.ts

# Or with environment variables
FIBER_RPC_URL=http://127.0.0.1:8227 npx tsx apps/node-examples/basic-payment.ts
```

## Examples

### [basic-payment.ts](basic-payment.ts)
Connect to a node, check balance, create an invoice, and send a payment.
Demonstrates `waitForPayment()` to poll until the payment settles.

### [hold-invoice.ts](hold-invoice.ts)
Create a hold invoice (escrow pattern) where funds are locked until the
receiver reveals the preimage. Demonstrates:
- Creating an invoice with `payment_hash` (no preimage upfront)
- Waiting for `Accepted` status
- Settling with `settle_invoice`

### [channel-lifecycle.ts](channel-lifecycle.ts)
Open a channel, wait for it to become ready using `waitForChannelReady()`,
send a test payment, then cooperatively close the channel.

### [watch-incoming.ts](watch-incoming.ts)
Watch for incoming payments using `watchIncomingPayments()` with
`AbortController` for graceful shutdown.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FIBER_RPC_URL` | `http://127.0.0.1:8227` | Fiber node RPC endpoint |

## Notes

- All amounts are in CKB (1 CKB = 10^8 shannons)
- These examples use testnet — do NOT use real funds
- Each example is self-contained and can be run independently
