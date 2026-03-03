---
"@fiber-pay/cli": minor
"@fiber-pay/sdk": minor
---

Add Biscuit auth support for CLI RPC calls and introduce SDK Biscuit policy helpers.

- CLI: support `--rpc-biscuit-token` and `FIBER_RPC_BISCUIT_TOKEN`, then forward token to SDK RPC client as `Authorization: Bearer <token>`
- SDK: add `biscuit-policy` helpers for upstream-aligned method-to-permission mapping and datalog fact generation
- Docs: move auth guidance into skill references and add cross-links (`skills/fiber-pay/references/auth.md`)
- Tests: add coverage for CLI auth config resolution and SDK biscuit policy helper
