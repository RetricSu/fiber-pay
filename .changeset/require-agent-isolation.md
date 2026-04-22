---
"@fiber-pay/cli": minor
---

# Agent Serve Isolation

feat(cli): require namespace isolation for `agent serve`

- Remove `--no-isolation` from `agent serve`
- Make Linux namespace isolation mandatory at startup
- Fail fast with `AGENT_SERVE_ISOLATION_REQUIRED` when `unshare` probe fails
- Remove directory-only fallback execution path
- Update setup and security docs to reflect strict isolation requirements
