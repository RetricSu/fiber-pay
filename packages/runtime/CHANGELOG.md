# @fiber-pay/runtime

## 0.1.0

### Patch Changes

- 3a7ea1b: Fix synchronous file I/O blocking in FNN log handling

  - Replace `appendFileSync` with async `WriteStream`-based `LogWriter` class
  - Add `flushPendingLogs()` for graceful shutdown coordination
  - Convert runtime alert file backends to async I/O
  - Improves performance under high-volume log output
  - Prevents event loop blocking that could stall FNN process

  Fixes #73

- Updated dependencies [cfcfcea]
- Updated dependencies [d0451e9]
- Updated dependencies [4c1c414]
- Updated dependencies [4438b9a]
  - @fiber-pay/sdk@0.1.0

## 0.1.0-rc.7

### Patch Changes

- 374a7e6: Fix payment tracker not-found detection to prevent repeated `getPayment` polling spam. The tracker now inspects structured RPC error payloads (for example nested `data` fields) when classifying errors, marks not-found tracked payments as terminal `Failed`, and emits failure alerts accordingly.
- Updated dependencies [cfcfcea]
- Updated dependencies [d0451e9]
  - @fiber-pay/sdk@0.1.0-rc.7

## 0.1.0-rc.6

### Patch Changes

- eea4e63: Fix dry-run payments causing infinite polling. The payment executor now short-circuits dry_run payments to `DryRunSuccess` instead of entering the inflight polling loop, and the RPC proxy no longer auto-tracks dry_run payment hashes.
- d4b2112: Fix infinite polling when tracked payment/invoice not found on Fiber node. Split `isExpectedTrackerError` to distinguish permanent not-found errors from transient network errors, marking not-found items as terminal and emitting alerts.
- 2e051f6: Fix lint warnings in runtime command fallback checks and restore runtime DTS build compatibility by avoiding optional-chain return type widening in proxy job hooks.
  - @fiber-pay/sdk@0.1.0-rc.6

## 0.1.0-rc.5

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
  - @fiber-pay/sdk@0.1.0-rc.5

## 0.1.0-rc.4

### Patch Changes

- @fiber-pay/sdk@0.1.0-rc.4
