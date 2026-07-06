---
'@fiber-pay/cli': minor
---

Add UDT channel support to `fiber-pay channel open`. The new `--funding-udt-type-script` option accepts a JSON CKB script (`code_hash`, `hash_type`, `args`) and routes the funding amount as raw UDT units instead of CKB.
