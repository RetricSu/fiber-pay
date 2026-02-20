# Development

Prerequisites:

- Node.js `>=20`
- `pnpm`

```bash
pnpm install
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
