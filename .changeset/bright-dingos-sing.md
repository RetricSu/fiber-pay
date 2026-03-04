---
"@fiber-pay/cli": patch
---

Add `fiber-pay node info` command to fetch node metadata via Fiber `node_info` RPC.

- CLI: add `node info` subcommand under `fiber-pay node`
- RPC: call existing SDK `nodeInfo()` method (mapped to `node_info`)
- Output: support both human-readable output and `--json` mode
