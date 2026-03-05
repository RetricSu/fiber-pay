---
"@fiber-pay/cli": patch
---

Add new CLI capabilities for wallet and node network visibility.

- Add `fiber-pay wallet address` to print the default funding address (human and `--json` output)
- Add `fiber-pay wallet balance` to query CKB balance from the funding lock script
- Add explicit error when `ckbRpcUrl` is missing for wallet balance lookup
- Add aggregated `node network` output and clean up related typing/lint issues
