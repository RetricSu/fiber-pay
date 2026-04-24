---
'@fiber-pay/cli': patch
---

Switch `agent serve` workspace static and directory list session auth to header-only (`x-session-id` and `x-session-token`), and remove URL-based session token/sessionId usage for these endpoints.
