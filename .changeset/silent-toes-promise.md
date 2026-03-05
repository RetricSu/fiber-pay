---
"@fiber-pay/runtime": patch
---

Fix payment tracker not-found detection to prevent repeated `getPayment` polling spam. The tracker now inspects structured RPC error payloads (for example nested `data` fields) when classifying errors, marks not-found tracked payments as terminal `Failed`, and emits failure alerts accordingly.
