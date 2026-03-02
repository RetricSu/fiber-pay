---
"@fiber-pay/cli": minor
"@fiber-pay/sdk": patch
---

Add dual-layer CLI support for rebalancing with both technical and high-level entries.

- Add technical `payment rebalance` for direct route control (`--hops`) and auto mode (`--max-fee`)
- Add high-level `channel rebalance` wrapper with optional guided mode via `--from-channel` + `--to-channel`
- Rebalance orchestration uses circular self-payment via `send_payment` / `send_payment_with_router` with `allow_self_payment: true`
- Add `--allow-self-payment` flag to `payment send-route`
- Extend SDK router payment params type with `allow_self_payment`
