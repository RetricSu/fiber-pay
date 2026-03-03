# @fiber-pay/runtime

## 1.0.0-rc.5

### Patch Changes

- bd992dd: Refactor persisted logs to use daily UTC date directories and align runtime/CLI behavior.

  - add date-based log directory helpers and date listing support in CLI log utilities
  - update `fiber-pay logs` and `job trace` with `--date` support, plus `logs --list-dates`
  - add runtime daily JSONL alert backend and wire startup/meta fields for daily log storage
  - refresh troubleshooting docs and tests for date-based log path behavior

- 077ec13: Include peer and temporary channel context fields in channel job alert payloads for better log correlation.
- 5be36b4: Make force-close jobs wait for closed state by default to avoid false-positive success transitions.
- Updated dependencies [4c1c414]
- Updated dependencies [4438b9a]
  - @fiber-pay/sdk@1.0.0-rc.5

## 0.1.0-rc.4

### Patch Changes

- @fiber-pay/sdk@0.1.0-rc.4
