---
"@fiber-pay/cli": patch
"@fiber-pay/runtime": patch
---

Refactor persisted logs to use daily UTC date directories and align runtime/CLI behavior.

- add date-based log directory helpers and date listing support in CLI log utilities
- update `fiber-pay logs` and `job trace` with `--date` support, plus `logs --list-dates`
- add runtime daily JSONL alert backend and wire startup/meta fields for daily log storage
- refresh troubleshooting docs and tests for date-based log path behavior
