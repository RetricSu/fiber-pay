# @fiber-pay/cli

## 1.0.0

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

- 20f4323: Add `fiber-pay node info` command to fetch node metadata via Fiber `node_info` RPC.

  - CLI: add `node info` subcommand under `fiber-pay node`
  - RPC: call existing SDK `nodeInfo()` method (mapped to `node_info`)
  - Output: support both human-readable output and `--json` mode

- bd992dd: Refactor persisted logs to use daily UTC date directories and align runtime/CLI behavior.

  - add date-based log directory helpers and date listing support in CLI log utilities
  - update `fiber-pay logs` and `job trace` with `--date` support, plus `logs --list-dates`
  - add runtime daily JSONL alert backend and wire startup/meta fields for daily log storage
  - refresh troubleshooting docs and tests for date-based log path behavior

- a6af286: Clarify npm-first installation guidance in docs and restore shared post-install CLI verification steps.
- cabeae2: Improve upgrade and migration safety/UX:

  - simplify `fiber-pay node upgrade` flags by removing ambiguous `--force`
  - make `--force-migrate` attempt migration even when compatibility pre-check is incompatible
  - normalize migration hints so users are guided by CLI commands instead of raw `fnn-migrate` invocations
  - add strict version-tag validation in binary download flow to prevent malformed/path-like version input
  - add migration/status messaging improvements and post-migration check warning when refresh fails

- b8026bc: Add new CLI capabilities for wallet and node network visibility.

  - Add `fiber-pay wallet address` to print the default funding address (human and `--json` output)
  - Add `fiber-pay wallet balance` to query CKB balance from the funding lock script
  - Add explicit error when `ckbRpcUrl` is missing for wallet balance lookup
  - Add BigInt-safe CKB formatting for wallet/network capacity output to avoid precision loss
  - Sanitize node/network-derived terminal strings to prevent escape-sequence injection in human output
  - Add aggregated `node network` output and clean up related typing/lint issues

- 0310480: Add `config profile list` command to list available Fiber profiles

  - Lists all profile subdirectories in `~/.fiber-pay/profiles/`
  - Shows 'default' profile if `~/.fiber-pay/config.yml` exists
  - Supports `--json` flag for machine-readable output
  - Profiles sorted alphabetically with 'default' at the top

  Closes #70

- 0f8cac4: Add `--qrcode` flag to `wallet address` command.

  - Add `--qrcode` option to display the funding address as a QR code in the terminal
  - Show truncated address (e.g., `ckt1qzda...9z7s0v0t`) below the QR code for reference
  - Add `qrcode` library as a dependency

- 3a7ea1b: Fix synchronous file I/O blocking in FNN log handling

  - Replace `appendFileSync` with async `WriteStream`-based `LogWriter` class
  - Add `flushPendingLogs()` for graceful shutdown coordination
  - Convert runtime alert file backends to async I/O
  - Improves performance under high-volume log output
  - Prevents event loop blocking that could stall FNN process

  Fixes #73

- a53b977: Align binary resolution with profile scope across CLI commands.

  - add a shared resolver for binary path/install dir selection
  - make `node start`, `node status`, `binary info/download`, and `node upgrade` follow the same resolution rules
  - default managed binary location to `<dataDir>/bin/fnn` when no custom `binaryPath` is set
  - show resolved binary path in human-readable `node status` diagnostics

- 120aa6b: Fix log path resolution for fnn sources when runtime metadata is partially populated, ensuring date-based daily log directories are used consistently.

  Also writes fnn stdout/stderr log paths to runtime metadata for runtime-start flows and updates related log path documentation.

- 99ac452: Recover stale runtime port handling for custom proxy listen addresses and harden process termination helpers.
- 2e051f6: Fix lint warnings in runtime command fallback checks and restore runtime DTS build compatibility by avoiding optional-chain return type widening in proxy job hooks.
- 5be36b4: Make force-close jobs wait for closed state by default to avoid false-positive success transitions.
- Updated dependencies [bd992dd]
- Updated dependencies [cabeae2]
- Updated dependencies [3a7ea1b]
- Updated dependencies [eea4e63]
- Updated dependencies [cfcfcea]
- Updated dependencies [d4b2112]
- Updated dependencies [077ec13]
- Updated dependencies [d0451e9]
- Updated dependencies [4c1c414]
- Updated dependencies [2e051f6]
- Updated dependencies [374a7e6]
- Updated dependencies [4438b9a]
- Updated dependencies [5be36b4]
  - @fiber-pay/runtime@1.0.0
  - @fiber-pay/node@1.0.0
  - @fiber-pay/sdk@1.0.0

## 0.1.0-rc.7

### Patch Changes

- Updated dependencies [cfcfcea]
- Updated dependencies [d0451e9]
- Updated dependencies [374a7e6]
  - @fiber-pay/sdk@0.1.0-rc.7
  - @fiber-pay/runtime@0.1.0-rc.7
  - @fiber-pay/node@0.1.0-rc.7

## 0.1.0-rc.6

### Patch Changes

- 20f4323: Add `fiber-pay node info` command to fetch node metadata via Fiber `node_info` RPC.

  - CLI: add `node info` subcommand under `fiber-pay node`
  - RPC: call existing SDK `nodeInfo()` method (mapped to `node_info`)
  - Output: support both human-readable output and `--json` mode

- b8026bc: Add new CLI capabilities for wallet and node network visibility.

  - Add `fiber-pay wallet address` to print the default funding address (human and `--json` output)
  - Add `fiber-pay wallet balance` to query CKB balance from the funding lock script
  - Add explicit error when `ckbRpcUrl` is missing for wallet balance lookup
  - Add BigInt-safe CKB formatting for wallet/network capacity output to avoid precision loss
  - Sanitize node/network-derived terminal strings to prevent escape-sequence injection in human output
  - Add aggregated `node network` output and clean up related typing/lint issues

- 2e051f6: Fix lint warnings in runtime command fallback checks and restore runtime DTS build compatibility by avoiding optional-chain return type widening in proxy job hooks.
- Updated dependencies [eea4e63]
- Updated dependencies [d4b2112]
- Updated dependencies [2e051f6]
  - @fiber-pay/runtime@0.1.0-rc.6
  - @fiber-pay/sdk@0.1.0-rc.6
  - @fiber-pay/node@0.1.0-rc.6

## 0.1.0-rc.5

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
  - @fiber-pay/runtime@0.1.0-rc.5
  - @fiber-pay/sdk@0.1.0-rc.5
  - @fiber-pay/node@0.1.0-rc.5

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
