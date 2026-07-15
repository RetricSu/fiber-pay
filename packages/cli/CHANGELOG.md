# @fiber-pay/cli

## 0.3.0

### Patch Changes

- @fiber-pay/sdk@0.3.0
- @fiber-pay/node@0.3.0
- @fiber-pay/runtime@0.3.0

## 0.2.8

### Patch Changes

- f9c208a: Make channel list/detail formatting UDT-aware, showing raw UDT units and the channel's `funding_udt_type_script`.
- 240cc94: Add UDT channel support to `fiber-pay channel open`. The new `--funding-udt-type-script` option accepts a JSON CKB script (`code_hash`, `hash_type`, `args`) and routes the funding amount as raw UDT units instead of CKB.

  BREAKING CHANGE: The JSON and human-readable output of `fiber-pay channel open` and `fiber-pay channel accept` now uses `fundingAmount` (in shannons for CKB, or raw UDT units) plus `fundingLabel` (`CKB` or `UDT`) instead of the previous `fundingCkb` field. The `--funding` option semantics are unchanged.

- f9c208a: Add UDT support to `invoice create` via `--udt-type-script` and `--udt-name`.
- f9c208a: Add UDT support to `payment route` via `--udt-type-script` and `--udt-name`.
- f9c208a: Add UDT support to `payment send` via `--udt-type-script` and `--udt-name`.
- f9c208a: Add UDT support to `payment rebalance` and `channel rebalance` via `--udt-type-script` and `--udt-name`.
- ca02a01: Move UDT support down into the core `@fiber-pay/sdk` package and reuse it across the React SDK and CLI.

  - `@fiber-pay/sdk` now exports UDT helpers: `UdtAsset`, `UdtTypeScript`, `parseUdtTypeScript`, `validateUdtTypeScript`, `parsePaymentAmount`, `parseFundingAmount`, `resolveUdtAsset`, and `formatChannelBalances`.
    - `resolveUdtAsset` no longer requires an RPC client when resolving by raw script.
    - `parseUdtTypeScript` and `validateUdtTypeScript` enforce a 32-byte `code_hash`, a reasonable `args` length limit, and an overall JSON length cap.
    - CKB amount parsing now tolerates trailing zeros beyond 8 decimal places (e.g. `1.000000000`).
    - `FormattedChannelBalances` is now a tagged union (`kind: 'ckb' | 'udt'`) instead of a weak `string | number` union.
  - `@fiber-pay/react` hooks (`useChannelOpenFlow`, `useFiberPayment`) accept an optional UDT asset, validate the UDT script before passing it to RPC, and avoid callback identity churn via an options ref.
    - `useChannelOpenFlow` now treats an empty `fundingAmount` string as missing so it correctly falls back to the deprecated `fundingAmountCkb`.
  - `@fiber-pay/cli` UDT parsing, asset resolution, and channel formatting are now delegated to the SDK instead of living in the CLI.
    - Added a unified `resolveAssetFromOptions` helper in `packages/cli/src/lib/udt.ts` to remove the repeated UDT resolution boilerplate across commands.
    - `formatChannel` now reuses the values returned by `formatChannelBalances` instead of recomputing them.

- Updated dependencies [240cc94]
- Updated dependencies [42724a3]
- Updated dependencies [2aa9402]
- Updated dependencies [42724a3]
- Updated dependencies [ca02a01]
  - @fiber-pay/node@0.2.8
  - @fiber-pay/sdk@0.2.8
  - @fiber-pay/runtime@0.2.8

## 0.2.7

### Patch Changes

- ec536f4: Upgrade default Fiber target to fnn v0.9.0-rc4

  - Remove support for the standalone `fnn-migrate` binary shipped with new fnn releases.
  - Add a legacy migration path that uses the v0.8.1 `fnn-migrate` to bring old stores up to the v0.9.0 epoch.
  - `node start` now auto-confirms fnn's built-in migration prompt.
  - SDK gains `listPayments` and node config gains v0.9.0-rc4 optional fields.
  - `fiber-pay node upgrade` now targets the bundled default Fiber version (`v0.9.0-rc4`) when `--version` is omitted, instead of resolving the GitHub latest release.
  - Remove the dangling `--force-migrate` option from `fiber-pay node upgrade`.

- Updated dependencies [42793f4]
- Updated dependencies [ec536f4]
  - @fiber-pay/node@0.2.7
  - @fiber-pay/sdk@0.2.7
  - @fiber-pay/runtime@0.2.7

## 0.2.6

### Patch Changes

- Updated dependencies [7bc83aa]
- Updated dependencies [b0610f7]
- Updated dependencies [06cfef0]
  - @fiber-pay/sdk@0.2.6
  - @fiber-pay/node@0.2.6
  - @fiber-pay/runtime@0.2.6

## 0.2.5

### Patch Changes

- 0d3955b: feat(cli): make `node upgrade` migration-first for custom binary paths.

  - Keep profile-managed binaries on download + migrate flow.
  - Run custom binary mode as migrate-only (skip binary download).
  - Improve migration guidance for custom binary setups and validate that custom `binaryPath` includes an explicit directory path for migration tooling.

- 272e77c: fix(sdk): normalize channel `state.state_name` on the browser/WASM path so it
  matches the `ChannelState` enum (SCREAMING_SNAKE_CASE) returned by the RPC
  client. This fixes `FiberBrowserNode.waitForChannelReady` and any consumer that
  compares `channel.state.state_name === ChannelState.ChannelReady` on the
  browser path.

  Internal: extracted `normalizeChannel` / `normalizeChannelStateName` from
  `FiberRpcClient` into a shared `rpc/normalize-channel` module used by both the
  RPC client and the WASM adapter.

- Updated dependencies [eb4b9c3]
- Updated dependencies [a0e3c78]
- Updated dependencies [272e77c]
- Updated dependencies [32c6228]
  - @fiber-pay/sdk@0.2.5
  - @fiber-pay/node@0.2.5
  - @fiber-pay/runtime@0.2.5

## 0.2.4

### Patch Changes

- eb644bb: Harden `agent serve` runtime behavior and docs for safer proxy usage and more stable session handling in local/BoxLite deployments.
- 7f61cae: Fix `agent serve` workspace cleanup behavior so TTL is enforced in hours (not days), and ensure cleanup scheduling is correctly re-armed to a 10-minute interval under disk pressure.
- de33cb8: feat(cli): sandbox agent serve with BoxLite

  - Add `BoxliteClient` to run `acpx` inside a BoxLite micro-VM via REST API
  - Replace bare `spawn('acpx')` in `agent-serve.ts` with sandboxed `BoxliteClient.exec()`
  - Add `--boxlite-url` and `--boxlite-box-id` CLI options to `agent serve`
  - Whitelist only safe environment variables (agent API keys) and block `FIBER_*`, `L402_*`, and `CKB_*` secrets
  - Fail fast with `process.exit(1)` if BoxLite is unreachable or the box is missing (no silent fallback)
  - Support BoxLite 0.8.2 async `/exec` API (execution_id → polling `/executions/{id}/output` with SSE base64 stream parsing)
  - Add BoxLite setup documentation (now consolidated under `packages/cli/docs/agent-serve-backend-setup.md`)

- 0927945: Filter non-actionable `acpx` reconnect stderr noise in `agent serve` SSE handling to reduce misleading log output while preserving actionable errors.
- bad399e: fix: persist target fiber version in profile to prevent auto-downgrade during node start
- 0f6ead3: Add `TransportType` and `addr_type` param to `ConnectPeerParams` for Fiber v0.8.1 (issue #110)

  - New `TransportType` union type: `'tcp' | 'ws' | 'wss'`
  - `ConnectPeerParams.addr_type` optional field for filtering peer addresses by transport protocol
  - CLI `peer connect` now accepts `--addr-type <tcp|ws|wss>` when connecting by pubkey
  - Especially useful in WASM/browser environments that only support WSS
  - Updated RPC type version comments to v0.8.1

- b8a3d4e: fix(cli): support pubkey in peer connect and unify pubkey terminology for v0.8.0

  - `peer connect` now accepts both pubkey and multiaddr
  - removed peerId display from peer connect output
  - renamed peerId -> pubkey in formatChannel JSON fields
  - removed peerId from node-status output, show Pubkey instead
  - updated rebalance error messages/details to use pubkey terminology

- 7c92eff: fix(cli): auto-build multiaddr from pubkey + address in peer connect

  - `peer connect <pubkey> --address <bare-multiaddr>` now automatically computes the peerId from the pubkey and appends `/p2p/<peerId>` to the address before sending the RPC call
  - `peer connect <pubkey>` still sends `{ pubkey }` and relies on graph resolution
  - `peer connect <multiaddr-with-p2p>` still sends `{ address }` directly
  - improved error message when a bare multiaddr is passed as the sole positional argument

- 53e5f03: Fix `channel open` to accept peer pubkeys without the `0x` prefix by auto-prepending it.
- 55d86bf: # Agent Serve Isolation

  feat(cli): require namespace isolation for `agent serve`

  - Remove `--no-isolation` from `agent serve`
  - Make Linux namespace isolation mandatory at startup
  - Fail fast with `AGENT_SERVE_ISOLATION_REQUIRED` when `unshare` probe fails
  - Remove directory-only fallback execution path
  - Breaking API contract: `agent serve` now issues signed session tokens; resuming a session requires both `sessionId` and `sessionToken`
  - Update setup and security docs to reflect strict isolation requirements

- 867a83b: Implement host-side HTTP proxy to secure agent API keys and enforce outbound network deny-list in BoxLite environments
- ece4316: Switch `agent serve` workspace static and directory list session auth to header-only (`x-session-id` and `x-session-token`), and remove URL-based session token/sessionId usage for these endpoints.
- Updated dependencies [b049830]
- Updated dependencies [0f6ead3]
- Updated dependencies [713aa2d]
  - @fiber-pay/sdk@0.2.4
  - @fiber-pay/node@0.2.4
  - @fiber-pay/runtime@0.2.4

## 0.2.3

### Patch Changes

- @fiber-pay/sdk@0.2.3
- @fiber-pay/node@0.2.3
- @fiber-pay/runtime@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [76bbe85]
- Updated dependencies [1e96626]
  - @fiber-pay/sdk@0.2.2
  - @fiber-pay/node@0.2.2
  - @fiber-pay/runtime@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [dec5314]
- Updated dependencies [3876ef5]
  - @fiber-pay/sdk@0.2.1
  - @fiber-pay/node@0.2.1
  - @fiber-pay/runtime@0.2.1

## 0.2.0

### Minor Changes

- 872c624: Migrate Fiber integration target to v0.8.0 across SDK, runtime, CLI, agent, and browser-facing flows.

  Key updates include pubkey-based RPC fields, v0.8.0 invoice/hash serialization semantics, downstream compatibility fixes, and aligned documentation/examples.

### Patch Changes

- 43c2cd1: fix: support fnn-migrate v0.8 argument changes and make force migration flow robust when pre-check is unavailable.
- 543461e: feat: add Browser WASM Node and WebAuthn PRF Passkey support
- Updated dependencies [b912f08]
- Updated dependencies [872c624]
- Updated dependencies [43c2cd1]
- Updated dependencies [543461e]
  - @fiber-pay/sdk@0.2.0
  - @fiber-pay/node@0.2.0
  - @fiber-pay/runtime@0.2.0

## 0.1.1

### Patch Changes

- a6e0236: Improve agent command UX and observability

  - **CLI**: Add request lifecycle logs to `fiber-pay agent serve` to show incoming requests, L402 challenge/payment status, and agent execution state
  - **CLI**: Improve `fiber-pay agent call` success output with clearer agent metadata, duration, payment details, and response section
  - **CLI**: Show common `--agent` values and usage examples in `fiber-pay agent serve -h`

- d9bd02b: Add L402 protocol support

  - **SDK**: New `L402Middleware`, `MacaroonService`, and `createL402Middleware` for building payment-gated APIs using the L402 protocol with Fiber Lightning Network
  - **CLI**: New `l402 proxy` command for reverse-proxying any HTTP service behind L402 payment
  - **CLI**: New `agent serve` and `agent call` commands for paid AI agent services via acpx

- Updated dependencies [d9bd02b]
  - @fiber-pay/sdk@0.1.1
  - @fiber-pay/node@0.1.1
  - @fiber-pay/runtime@0.1.1

## 0.1.0

### Patch Changes

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
  - @fiber-pay/runtime@0.1.0
  - @fiber-pay/node@0.1.0
  - @fiber-pay/sdk@0.1.0

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
