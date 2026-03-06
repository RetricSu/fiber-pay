---
"@fiber-pay/sdk": patch
---

Fix HashAlgorithm casing mismatch with FNN RPC. Add internal value mapping in `newInvoice` to convert PascalCase (`'CkbHash' | 'Sha256'`) to snake_case (`'ckb_hash' | 'sha256'`) before sending to FNN v0.7.1 RPC, maintaining backward compatibility.

See https://github.com/RetricSu/fiber-pay/issues/66
