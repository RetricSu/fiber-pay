---
"@fiber-pay/runtime": patch
---

Fix infinite polling when tracked payment/invoice not found on Fiber node. Split `isExpectedTrackerError` to distinguish permanent not-found errors from transient network errors, marking not-found items as terminal and emitting alerts.
