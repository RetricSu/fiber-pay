---
"@fiber-pay/cli": patch
"@fiber-pay/node": patch
---

Improve upgrade and migration safety/UX:

- simplify `fiber-pay node upgrade` flags by removing ambiguous `--force`
- make `--force-migrate` attempt migration even when compatibility pre-check is incompatible
- normalize migration hints so users are guided by CLI commands instead of raw `fnn-migrate` invocations
- add strict version-tag validation in binary download flow to prevent malformed/path-like version input
- add migration/status messaging improvements and post-migration check warning when refresh fails
