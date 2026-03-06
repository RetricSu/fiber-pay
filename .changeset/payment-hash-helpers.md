---
"@fiber-pay/sdk": patch
---

Add payment hash helper functions for HashAlgorithm (CkbHash / Sha256)

- `hashPreimage(preimageHex, algorithm)`: Compute payment hash from preimage
- `verifyPreimageHash(preimageHex, paymentHash, algorithm)`: Verify preimage matches hash
- `ckbHash(data)`: Low-level CKB blake2b-256 with "ckb-default-hash" personalization
- `sha256Hash(data)`: Low-level SHA-256

Uses browser-compatible implementation (no Buffer dependency).
Closes #65
