---
"@fiber-pay/cli": minor
---

# Agent Serve Isolation

feat(cli): require namespace isolation for `agent serve`

- Remove `--no-isolation` from `agent serve`
- Make Linux namespace isolation mandatory at startup
- Fail fast with `AGENT_SERVE_ISOLATION_REQUIRED` when `unshare` probe fails
- Remove directory-only fallback execution path
- Breaking API contract: `agent serve` now issues signed session tokens; resuming a session requires both `sessionId` and `sessionToken`
- Update setup and security docs to reflect strict isolation requirements
