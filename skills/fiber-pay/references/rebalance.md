# Rebalance Runbook

Use this guide when channel liquidity becomes skewed and payments start failing due to insufficient outbound capacity on key channels.

## 1) What rebalance does

Rebalance uses a **circular self-payment** to move liquidity between your own channels.

- Total funds remain unchanged (except routing fees).
- Channel balances are re-distributed across your channel set.
- This is payment-path execution, not direct channel state mutation.

## 2) Why command lives under `channel`

User intent is channel liquidity management, so `channel rebalance` is the high-level operator command.

Atomic payment primitives remain under `payment`:

- `payment send`
- `payment route`
- `payment send-route`

`channel rebalance` internally orchestrates these payment primitives.

## 3) Command usage

Auto mode (preferred first):

```bash
fiber-pay channel rebalance --amount <CKB> --max-fee <CKB> --dry-run --json
fiber-pay channel rebalance --amount <CKB> --max-fee <CKB> --json
```

Manual route mode (pin path hops):

```bash
fiber-pay channel rebalance --amount <CKB> --hops <peerA_pubkey>,<peerB_pubkey> --dry-run --json
fiber-pay channel rebalance --amount <CKB> --hops <peerA_pubkey>,<peerB_pubkey> --json
```

## 4) Parameter semantics

- `--amount`: required CKB amount to rebalance.
- `--max-fee`: optional cap for auto mode only.
- `--hops`: optional comma-separated hop pubkeys for manual mode.
- `--dry-run`: simulate and inspect feasibility/cost before sending.

Validation behavior:

- `--amount` must be positive.
- If `--hops` is provided, it must resolve to a non-empty pubkey list.
- `--max-fee` cannot be combined with manual `--hops` mode.

## 5) Operational checklist

1. Ensure node/runtime and channels are ready.
2. Run with `--dry-run` first.
3. Confirm fee is acceptable.
4. Execute without `--dry-run`.
5. Check `channel list --json` before/after to verify rebalance effect.

## 6) Related docs

- `references/core-operation.md`
- Fiber upstream concept doc: https://github.com/nervosnetwork/fiber/blob/develop/docs/channel-rebalancing.md
