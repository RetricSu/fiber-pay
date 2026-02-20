---
name: fiber-pay
description: Operate CKB Lightning payments through fiber-pay CLI. Use when tasks involve node lifecycle, channel management, invoice/payment flows, config tuning, or multi-node orchestration on Fiber Network v0.6.1.
---

# fiber-pay

fiber-pay is an AI payment layer over Fiber Network for CKB Lightning. It provides an AI-friendly CLI to manage node lifecycle, channels, invoices, payments, and more.

- Last updated: 2026-02-19
- Fiber node target: v0.6.1
- Fiber RPC reference: https://github.com/nervosnetwork/fiber/blob/v0.6.1/crates/fiber-lib/src/rpc/README.md

## Architecture

fiber-pay primarily controls the local `fnn` binary and interacts through RPC; most CLI atomic commands are direct mappings or thin orchestration wrappers over RPC methods. On top of atomic commands, fiber-pay introduces a runtime for complex operations.

Think in layers:

1. **Atomic command layer**: grouped commands (`node/channel/invoice/payment/job/...`) provide user/operator entry points.
2. **Runtime orchestration layer**: job lifecycle, retries, event history, and monitoring.
3. **Runtime proxy API layer**: HTTP API used by runtime-backed command paths.

In runtime-active scenarios, write operations are generally job-first and then observable via `job list/get/events/trace`.

## Install

For CLI installation and local linking workflow, read [references/install.md](references/install.md).

## CLI usage principle

### Learn progressively with `-h`

Do NOT memorize every flag. When unsure about a command's options, run `-h` first. This saves tokens and guarantees correct, up-to-date flag usage.

1. `fiber-pay -h` → discover command groups
2. `fiber-pay <group> -h` → discover subcommands (e.g. `fiber-pay channel -h`)
3. `fiber-pay <group> <cmd> -h` → discover flags (e.g. `fiber-pay channel open -h`)

### Be proactive

Try bootstrap the node, prepare channels, and get the payment network ready end-to-end without waiting for step-by-step instructions.

Only ask users for missing pieces of information that they would know but you don't (e.g. "what's the multiaddr of the peer you want to connect to?", "Do you want custom password or default one?", "Please deposit some CKB to my funding address: <funding-address>") instead of asking for every single command or flag.

### Understand Output convention

- Always use `--json` when output is consumed by agents or scripts.
- For command output and stream contracts, read `references/contracts.md`.
- For runtime HTTP endpoints and job semantics, read `references/runtime-api.md`.

## Operational guides

Read [references/core-operation.md](references/core-operation.md) for end-to-end payment operations: readiness gate, bootstrap, peer/channel setup, send/receive flow, and failure recovery sequence.

## References

- **Install & local linking**: Read [references/install.md](references/install.md) for clone/build/link setup (`pnpm install`, `pnpm build`, `pnpm link --global`).
- **Full fnn config keys**: Read [references/config.md](references/config.md) for structured key/value/default tables across all config sections (`fiber`, `rpc`, `ckb`, `cch`).
- **Fiber-pay config operations guide**: Read [references/configuration.md](references/configuration.md) for config source-of-truth, path operations, and profile/runtime config scope.
- **Profile & multi-node**: Read [references/profile.md](references/profile.md) for how profiles work, data directory layout, multi-node port scheme, and what `node start` does/doesn't auto-handle.
- **Logs & black-box debugging**: Read [references/logs-troubleshooting.md](references/logs-troubleshooting.md) first when startup/channel/payment issues are unclear. Start with section `7) Agent debugging micro-habits (logs-first)`, then pivot to `job trace <jobId>` and `job events --with-data` before guessing root causes.
- **Output contracts**: Read [references/contracts.md](references/contracts.md) for JSON envelope, NDJSON stream events, and timeout semantics.
- **Runtime API**: Read [references/runtime-api.md](references/runtime-api.md) for `/jobs/*` and `/monitor/*` endpoints and state model.
