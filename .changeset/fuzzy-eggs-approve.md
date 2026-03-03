---
"@fiber-pay/cli": patch
---

Align binary resolution with profile scope across CLI commands.

- add a shared resolver for binary path/install dir selection
- make `node start`, `node status`, `binary info/download`, and `node upgrade` follow the same resolution rules
- default managed binary location to `<dataDir>/bin/fnn` when no custom `binaryPath` is set
- show resolved binary path in human-readable `node status` diagnostics
