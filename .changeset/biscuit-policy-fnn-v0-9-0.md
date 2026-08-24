---
"@fiber-pay/sdk": patch
---

Align the Biscuit policy table with fnn v0.9.0. `receive_btc` now requires `write("cch")` (was `read("cch")`), all dev RPCs (`commitment_signed`, `add_tlc`, `remove_tlc`, `check_channel_shutdown`, `submit_commitment_transaction`, plus newly covered `sign_external_funding_tx`) now require `write("dev")`, and `list_payments` (`read("payments")`) and `pprof` (`write("pprof")`) are now covered. Tokens minted from the previous table were rejected by fnn v0.9.0 nodes for `receive_btc` and every dev method.

`collectBiscuitPermissions` and `renderBiscuitFactsForMethods` now also grant `read("cch")` whenever `write("cch")` is collected (opt out with `{ cchReadCompat: false }`): on fnn v0.9.0 a write-only cch token cannot call `get_cch_order`, and pre-v0.9.0 nodes still require `read("cch")` for `receive_btc`.

`subscribe_store_changes` and `backup_now` remain deliberately unmintable: the former requires the node-internal `internal("store_changes")` scope, and the latter is registered upstream under a rule key (`backup_now`) that does not match the RPC method name (`backup`), so authenticated calls are fail-closed regardless of token contents.
