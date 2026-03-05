---
"@fiber-pay/runtime": patch
---

Fix dry-run payments causing infinite polling. The payment executor now short-circuits dry_run payments to `DryRunSuccess` instead of entering the inflight polling loop, and the RPC proxy no longer auto-tracks dry_run payment hashes.
