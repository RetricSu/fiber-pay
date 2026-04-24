---
"@fiber-pay/cli": patch
---

Fix `agent serve` workspace cleanup behavior so TTL is enforced in hours (not days), and ensure cleanup scheduling is correctly re-armed to a 10-minute interval under disk pressure.
