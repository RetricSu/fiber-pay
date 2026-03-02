---
"@fiber-pay/cli": minor
"@fiber-pay/sdk": patch
---

Add CLI support for channel rebalancing with a new `channel rebalance` command.

- Auto mode uses circular self-payment via `send_payment` with `allow_self_payment: true`
- Manual mode supports fixed hop routes via `build_router` + `send_payment_with_router`
- Add `--allow-self-payment` flag to `payment send-route`
- Extend SDK router payment params type with `allow_self_payment`
