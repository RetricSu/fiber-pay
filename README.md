# fiber-pay

AI-friendly SDK + CLI for CKB Lightning on Fiber Network.

Fiber target: `v0.6.1`

## Positioning

`fiber-pay` is built to make Fiber programmable for both humans and AI agents:

- `@fiber-pay/sdk`: typed building blocks for Fiber RPC, verification, and policy logic
- `@fiber-pay/cli`: stable operator + automation interface with machine-readable output
- `@fiber-pay/node`: local runtime substrate for managing the `fnn` binary lifecycle
- `@fiber-pay/runtime`: orchestration runtime for jobs, monitoring, retries, and proxy-facing automation loops

This repository currently emphasizes SDK + CLI + runtime quality and agent usability through clear command contracts.

## Why this repo is AI-friendly

- Canonical skill guide for agents: `skills/fiber-pay/SKILL.md`
- Predictable grouped commands (`node/channel/invoice/payment/job/peer/binary/config/graph/runtime`)
- Uniform `--json` envelopes for reliable parsing and tool chaining
- NDJSON stream events for `watch --json` commands
- Explicit defaults for startup, ports, binary path, and key password behavior

## Quick start

Prerequisites:

- Node.js `>=20`
- `pnpm`

```bash
pnpm install
pnpm build
cd packages/cli && pnpm link --global
```

Install reference (canonical): `skills/fiber-pay/references/install.md`

## Command truth and learning model

- Stable knowledge (workflow, architecture, contracts): `skills/fiber-pay/SKILL.md` + `skills/fiber-pay/references/**`
- Exact command syntax and latest flags: CLI progressive help + command source

```bash
fiber-pay -h
fiber-pay <group> -h
fiber-pay <group> <cmd> -h
```

Implementation source for command behavior:

- `packages/cli/src/commands/**`

## Core smoke workflow (runtime-backed)

Use this as the canonical end-to-end operator flow:

```bash
fiber-pay node start --daemon
fiber-pay node ready --json
fiber-pay peer connect <peer-multiaddr> --json
fiber-pay channel open --peer <peer-multiaddr> --funding <ckb> --json
fiber-pay channel watch --state ChannelReady --timeout 180 --on-timeout fail --json
fiber-pay payment send <invoice> --wait --json
fiber-pay job list --json
```

Notes:

- `payment send` does not auto-open channels; verify channel readiness first.
- Use `--json` for automation and agent parsing.
- Use `job get/events/trace` and `logs` for diagnosis.

## Contracts and runtime architecture

For stable machine-facing behavior, use these references:

- Output + stream contracts: `skills/fiber-pay/references/contracts.md`
- Runtime proxy model: `skills/fiber-pay/references/runtime-api.md`
- Profile/multi-node model: `skills/fiber-pay/references/profile.md`
- Logs troubleshooting: `skills/fiber-pay/references/logs-troubleshooting.md`
- Full fnn config keys: `skills/fiber-pay/references/config.md`

Machine-readable error catalog:

- `packages/cli/error-codes.json`

## Copy-paste prompt for your coding agent

Use this prompt in Cursor/Claude/Copilot/other agents:

```text
Follow this document https://raw.githubusercontent.com/RetricSu/fiber-pay/main/skills/fiber-pay/SKILL.md to equip yourself with a p2p payment system.
```

## Source of truth

- Skill knowledge and workflow contracts: `skills/fiber-pay/SKILL.md` + `skills/fiber-pay/references/**`
- Command behavior and latest flags: `packages/cli/src/commands/**` and `fiber-pay ... -h`
- Maintainer alignment notes: `AGENT.md`
- Intent docs: `docs/plans/ai-payment-layer-intent.md`
- Fiber-pay Config docs: `skills/fiber-pay/references/configuration.md`
- fnn config artifact: `skills/fiber-pay/references/fnn.reference.yml` (full commented reference)

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
```

Package-scoped checks:

```bash
pnpm --filter @fiber-pay/sdk test
pnpm --filter @fiber-pay/cli typecheck
pnpm --filter @fiber-pay/cli build
pnpm --filter @fiber-pay/runtime test
```

## Release to npm (multi-package)

This repo publishes all `@fiber-pay/*` packages in lockstep via Git tag.

### Tag rules

- Stable release: `vX.Y.Z` -> npm dist-tag `latest`
- Pre-release: `vX.Y.Z-rc.N` / `vX.Y.Z-beta.N` -> npm dist-tag `next`

### Publish flow

- Bump versions in all publishable packages to the same version:

```bash
pnpm release:bump 0.1.1
```

This updates:

- `packages/sdk/package.json`
- `packages/node/package.json`
- `packages/runtime/package.json`
- `packages/agent/package.json`
- `packages/cli/package.json`

- Push commit to `main`.
- Create and push tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

For pre-release:

```bash
git tag v0.1.2-rc.1
git push origin v0.1.2-rc.1
```

### Required GitHub secret

- `NPM_TOKEN`: npm automation token with publish permission for `@fiber-pay/*`

Workflow file: `.github/workflows/release.yml`

## E2E dual-node script

Run:

```bash
node scripts/e2e-testnet-dual-node.mjs
```

The script drives: peer connect → channel open → invoice create → payment send → channel close.

Useful env overrides:

- `SKIP_BUILD=1`
- `SKIP_DEPOSIT=1`
- `SKIP_BINARY_DOWNLOAD=1`
- `FIBER_BINARY_VERSION=v0.6.1`
- `CHANNEL_FUNDING_CKB`, `INVOICE_AMOUNT_CKB`, `DEPOSIT_AMOUNT_CKB`
- `NODE_A_RPC_PORT`, `NODE_A_P2P_PORT`, `NODE_B_RPC_PORT`, `NODE_B_P2P_PORT`

## E2E runtime orchestration script (job path)

Reusable regression for runtime job orchestration (`/jobs/channel`, `/jobs/invoice`, `/jobs/payment`):

```bash
pnpm e2e:runtime-jobs
```

It validates this flow through runtime jobs: peer connect → channel open → invoice create → payment send → channel shutdown.

Useful env overrides:

- `PROFILE_A`, `PROFILE_B` (default `rt-a`, `rt-b`)
- `PROXY_A_URL`, `PROXY_B_URL` (default `http://127.0.0.1:9729`, `http://127.0.0.1:9829`)
- `CHANNEL_FUNDING_CKB`, `INVOICE_AMOUNT_CKB`, `INVOICE_CURRENCY`
- `JOB_TIMEOUT_SEC`, `POLL_INTERVAL_MS`, `PEER_CONNECT_TIMEOUT_SEC`
- `FIBER_PAY_BIN` (optional; by default script uses local `packages/cli/dist/cli.js` via current Node)

Machine-readable output:

```bash
pnpm e2e:runtime-jobs -- --json
```

## TODO

- [x] alert new channel to accept and add funding (`new_inbound_channel_request`)
- [x] alert new invoice coming (`incoming_payment_received`)
- [x] alert new payment coming (`new_pending_tlc`, `channel_balance_changed`)
- [x] channel status snapshot check (`channel_became_ready`, channel diff)
- [x] alert channel closed (`channel_closing`)
