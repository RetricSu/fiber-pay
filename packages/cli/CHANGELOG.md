# @fiber-pay/cli

## 1.0.0-rc.5

### Major Changes

- 9855bf3: Remove `fiber-pay node info` and standardize on `fiber-pay node status`.

  - drop the `node info` subcommand entirely
  - merge node identity/details fields into `node status` output (human + `--json`)
  - keep `node ready` focused on automation-readiness summary
  - update docs/examples to use `node status` for node diagnostics and identity checks

### Minor Changes

- 4c1c414: Add Biscuit auth support for CLI RPC calls and introduce SDK Biscuit policy helpers.

  - CLI: support `--rpc-biscuit-token` and `FIBER_RPC_BISCUIT_TOKEN`, then forward token to SDK RPC client as `Authorization: Bearer <token>`
  - SDK: add `biscuit-policy` helpers for upstream-aligned method-to-permission mapping and datalog fact generation
  - Docs: move auth guidance into skill references and add cross-links (`skills/fiber-pay/references/auth.md`)
  - Tests: add coverage for CLI auth config resolution and SDK biscuit policy helper

- 4438b9a: Add dual-layer CLI support for rebalancing with both technical and high-level entries.

  - Add technical `payment rebalance` for direct route control (`--hops`) and auto mode (`--max-fee`)
  - Add high-level `channel rebalance` wrapper with optional guided mode via `--from-channel` + `--to-channel`
  - Rebalance orchestration uses circular self-payment via `send_payment` / `send_payment_with_router` with `allow_self_payment: true`
  - Add `--allow-self-payment` flag to `payment send-route`
  - Extend SDK router payment params type with `allow_self_payment`

### Patch Changes

- bd992dd: Refactor persisted logs to use daily UTC date directories and align runtime/CLI behavior.

  - add date-based log directory helpers and date listing support in CLI log utilities
  - update `fiber-pay logs` and `job trace` with `--date` support, plus `logs --list-dates`
  - add runtime daily JSONL alert backend and wire startup/meta fields for daily log storage
  - refresh troubleshooting docs and tests for date-based log path behavior

- a6af286: Clarify npm-first installation guidance in docs and restore shared post-install CLI verification steps.
- a53b977: Align binary resolution with profile scope across CLI commands.

  - add a shared resolver for binary path/install dir selection
  - make `node start`, `node status`, `binary info/download`, and `node upgrade` follow the same resolution rules
  - default managed binary location to `<dataDir>/bin/fnn` when no custom `binaryPath` is set
  - show resolved binary path in human-readable `node status` diagnostics

- 120aa6b: Fix log path resolution for fnn sources when runtime metadata is partially populated, ensuring date-based daily log directories are used consistently.

  Also writes fnn stdout/stderr log paths to runtime metadata for runtime-start flows and updates related log path documentation.

- 99ac452: Recover stale runtime port handling for custom proxy listen addresses and harden process termination helpers.
- 5be36b4: Make force-close jobs wait for closed state by default to avoid false-positive success transitions.
- Updated dependencies [bd992dd]
- Updated dependencies [077ec13]
- Updated dependencies [4c1c414]
- Updated dependencies [4438b9a]
- Updated dependencies [5be36b4]
  - @fiber-pay/runtime@1.0.0-rc.5
  - @fiber-pay/sdk@1.0.0-rc.5
  - @fiber-pay/node@1.0.0-rc.5

## 0.1.0-rc.4

### Patch Changes

- cabeae2: Improve upgrade and migration safety/UX:

  - simplify `fiber-pay node upgrade` flags by removing ambiguous `--force`
  - make `--force-migrate` attempt migration even when compatibility pre-check is incompatible
  - normalize migration hints so users are guided by CLI commands instead of raw `fnn-migrate` invocations
  - add strict version-tag validation in binary download flow to prevent malformed/path-like version input
  - add migration/status messaging improvements and post-migration check warning when refresh fails

- Updated dependencies [cabeae2]
  - @fiber-pay/node@0.1.0-rc.4
  - @fiber-pay/sdk@0.1.0-rc.4
  - @fiber-pay/runtime@0.1.0-rc.4
