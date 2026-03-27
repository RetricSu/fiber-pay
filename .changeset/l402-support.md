---
"@fiber-pay/sdk": minor
"@fiber-pay/cli": minor
---

Add L402 protocol support

- **SDK**: New `L402Middleware`, `MacaroonService`, and `createL402Middleware` for building payment-gated APIs using the L402 protocol with Fiber Lightning Network
- **CLI**: New `l402 proxy` command for reverse-proxying any HTTP service behind L402 payment
- **CLI**: New `agent serve` and `agent call` commands for paid AI agent services via acpx
