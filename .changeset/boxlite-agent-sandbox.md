---
"@fiber-pay/cli": patch
---

feat(cli): sandbox agent serve with BoxLite

- Add `BoxliteClient` to run `acpx` inside a BoxLite micro-VM via REST API
- Replace bare `spawn('acpx')` in `agent-serve.ts` with sandboxed `BoxliteClient.exec()`
- Add `--boxlite-url` and `--boxlite-box-id` CLI options to `agent serve`
- Whitelist only safe environment variables (agent API keys) and block `FIBER_*`, `L402_*`, and `CKB_*` secrets
- Fail fast with `process.exit(1)` if BoxLite is unreachable or the box is missing (no silent fallback)
- Support BoxLite 0.8.2 async `/exec` API (execution_id → polling `/executions/{id}/output` with SSE base64 stream parsing)
- Add `docs/boxlite-agent-setup.md` with manual BoxLite configuration guide
