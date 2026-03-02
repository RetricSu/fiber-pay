# Rebalance Runbook

Use this guide when channel liquidity becomes skewed and payments start failing due to insufficient outbound capacity on key channels.

## 1) What rebalance does

Rebalance uses a **circular self-payment** to move liquidity between your own channels.

- Total funds remain unchanged (except routing fees).
- Channel balances are re-distributed across your channel set.
- This is payment-path execution, not direct channel state mutation.

## 1.1) Prerequisites (must satisfy)

- Rebalance is meaningful only when you have at least **two usable channels**.
- Guided mode requires the selected channel peers to be currently resolvable from `peer list` (peer_id -> pubkey mapping).
- Use `--dry-run` first and confirm fee/capacity before sending.

Quick checks:

```bash
fiber-pay channel list --state ChannelReady --json
fiber-pay peer list --json
```

## 2) Command layering (`payment` + `channel`)

`payment rebalance` is kept as the atomic/technical rebalance entry.

`channel rebalance` is the high-level operator entry for channel liquidity intent.

Atomic payment primitives remain under `payment`:

- `payment rebalance`
- `payment send`
- `payment route`
- `payment send-route`

`channel rebalance` applies the same payment-layer rebalance orchestration for easier user mental model.

## 3) Command usage

Auto mode (preferred first):

```bash
fiber-pay payment rebalance --amount <CKB> --max-fee <CKB> --dry-run --json
fiber-pay payment rebalance --amount <CKB> --max-fee <CKB> --json

fiber-pay channel rebalance --amount <CKB> --max-fee <CKB> --dry-run --json
fiber-pay channel rebalance --amount <CKB> --max-fee <CKB> --json
```

Manual route mode (pin path hops, payment-level technical mode):

```bash
fiber-pay payment rebalance --amount <CKB> --hops <peerA_pubkey>,<peerB_pubkey> --dry-run --json
fiber-pay payment rebalance --amount <CKB> --hops <peerA_pubkey>,<peerB_pubkey> --json
```

Guided channel mode (high-level wrapper by channel id):

```bash
fiber-pay channel rebalance --amount <CKB> --from-channel <channelA_id> --to-channel <channelB_id> --dry-run --json
fiber-pay channel rebalance --amount <CKB> --from-channel <channelA_id> --to-channel <channelB_id> --json
```

Notes:

- `channel rebalance` intentionally hides raw hop-level controls.
- For precise route pinning, use `payment rebalance --hops ...`.

## 3.1) Direction decision table (operator shortcut)

Use this when choosing `--from-channel` and `--to-channel` in guided mode:

| Intent | `--from-channel` | `--to-channel` |
|---|---|---|
| Increase local/outbound balance on channel `X` | a different channel with excess local balance | `X` |
| Reduce local/outbound balance on channel `X` | `X` | a different channel |

Interpretation (aligned with Fiber circular-payment model): funds flow out via `from`-side path and return via `to`-side path.

Concrete examples:

```bash
# increase local balance on TARGET channel
fiber-pay channel rebalance --amount 10 --from-channel <SOURCE_ID> --to-channel <TARGET_ID> --dry-run --json
fiber-pay channel rebalance --amount 10 --from-channel <SOURCE_ID> --to-channel <TARGET_ID> --json

# decrease local balance on TARGET channel
fiber-pay channel rebalance --amount 10 --from-channel <TARGET_ID> --to-channel <OTHER_ID> --dry-run --json
fiber-pay channel rebalance --amount 10 --from-channel <TARGET_ID> --to-channel <OTHER_ID> --json
```

Single-channel case:

- With only one channel, `channel rebalance` cannot effectively shift liquidity between your channels.
- Usually you need to open another channel or receive inbound payments first, then rebalance.

## 4) Parameter semantics

- `--amount`: required CKB amount to rebalance.
- `--max-fee`: optional cap for auto mode only.
- `--hops`: payment-only optional comma-separated hop pubkeys for manual mode.
- `--from-channel` + `--to-channel`: channel-only guided mode input (must be provided together).
- `--dry-run`: simulate and inspect feasibility/cost before sending.

Validation behavior:

- `--amount` must be positive.
- If `--hops` is provided (payment mode), it must resolve to a non-empty pubkey list.
- `--max-fee` cannot be combined with manual route mode.
- Guided channel mode requires both channel ids and they must map to different peer ids.
- Guided channel mode also requires both channel peers to be resolvable to pubkeys from current `peer list`.

## 5) Operational checklist

1. Ensure node/runtime and channels are ready.
2. Run with `--dry-run` first.
3. Confirm fee is acceptable.
4. Execute without `--dry-run`.
5. Check `channel list --json` before/after to verify rebalance effect.

Failure hints:

- `CHANNEL_REBALANCE_INPUT_INVALID` with peer mapping details: run `peer list --json`, ensure both peers are connected, retry guided mode.
- Route/fee failure in dry-run: lower amount, widen path choice (auto mode), or adjust max fee.

## 6) Related docs

- `references/core-operation.md`
- Fiber upstream concept doc: https://github.com/nervosnetwork/fiber/blob/develop/docs/channel-rebalancing.md
