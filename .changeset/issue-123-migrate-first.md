---
'@fiber-pay/cli': patch
---

feat(cli): make `node upgrade` migration-first for custom binary paths.

- Keep profile-managed binaries on download + migrate flow.
- Run custom binary mode as migrate-only (skip binary download).
- Improve migration guidance for custom binary setups and validate that custom `binaryPath` includes an explicit directory path for migration tooling.
