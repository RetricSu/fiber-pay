---
"@fiber-pay/cli": major
---

Remove `fiber-pay node info` and standardize on `fiber-pay node status`.

- drop the `node info` subcommand entirely
- merge node identity/details fields into `node status` output (human + `--json`)
- keep `node ready` focused on automation-readiness summary
- update docs/examples to use `node status` for node diagnostics and identity checks
