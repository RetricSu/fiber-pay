---
"@fiber-pay/cli": patch
---

Improve agent command UX and observability

- **CLI**: Add request lifecycle logs to `fiber-pay agent serve` to show incoming requests, L402 challenge/payment status, and agent execution state
- **CLI**: Improve `fiber-pay agent call` success output with clearer agent metadata, duration, payment details, and response section
- **CLI**: Show common `--agent` values and usage examples in `fiber-pay agent serve -h`
