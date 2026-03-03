---
"@fiber-pay/cli": patch
---

Fix log path resolution for fnn sources when runtime metadata is partially populated, ensuring date-based daily log directories are used consistently.

Also writes fnn stdout/stderr log paths to runtime metadata for runtime-start flows and updates related log path documentation.
