---
---

Document the test workflow consolidation and fixed-key e2e strategy:

- simplify repository scripts to one smoke entry (`pnpm smoke`) and one canonical e2e entry (`pnpm e2e`)
- remove overlapping/unused scripts and keep CI focused on one-click `workflow_dispatch` e2e
- switch e2e to embedded fixed testnet keys and document funding addresses plus one-time top-up commands
- keep package release versions unchanged for this infra/docs/script-only adjustment
