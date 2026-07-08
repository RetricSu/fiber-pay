---
'@fiber-pay/cli': minor
---

Add UDT channel support to `fiber-pay channel open`. The new `--funding-udt-type-script` option accepts a JSON CKB script (`code_hash`, `hash_type`, `args`) and routes the funding amount as raw UDT units instead of CKB.

BREAKING CHANGE: The JSON and human-readable output of `fiber-pay channel open` and `fiber-pay channel accept` now uses `fundingAmount` (in shannons for CKB, or raw UDT units) plus `fundingLabel` (`CKB` or `UDT`) instead of the previous `fundingCkb` field. The `--funding` option semantics are unchanged.
