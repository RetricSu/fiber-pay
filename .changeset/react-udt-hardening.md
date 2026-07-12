---
'@fiber-pay/react': patch
'@fiber-pay/sdk': patch
---

Harden high-level React UDT flows by fixing StrictMode state handling, validating invoice network and serialized UDT identity before payment, recovering channel actions after invalid scripts, matching channel labels by type script, inheriting network from shared Fiber sessions, and exposing asset-aware external funding context. Also add canonical UDT script serialization/equality helpers and reject incomplete hex bytes.
