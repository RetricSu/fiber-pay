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

This repo uses `changesets` to manage lockstep versioning and auto-generate package changelogs.

### Versioning model

- All publishable `@fiber-pay/*` packages are in a fixed group (same version).
- Changelogs are generated automatically during `changeset version`.

### Release flow

1. Add a changeset after code changes:

```bash
pnpm changeset
```

2. Keep prerelease (`rc`) mode when needed:

```bash
pnpm changeset pre enter rc
```

3. Consume changesets, bump versions, and generate changelogs:

```bash
pnpm changeset:version
```

4. Commit and push version/changelog changes to `master`.

5. Create and push a release tag (or create a GitHub Release with that tag):

```bash
git tag v0.1.1
git push origin v0.1.1
```

For prerelease:

```bash
git tag v0.1.2-rc.1
git push origin v0.1.2-rc.1
```

6. Exit prerelease mode when preparing stable releases:

```bash
pnpm changeset pre exit
```

### Notes

- `pnpm changeset:status` shows pending release changes.
- Release workflow is tag-driven (`v*`) in `.github/workflows/release.yml`.
- Stable tags (`vX.Y.Z`) publish with npm dist-tag `latest`; prerelease tags publish with `next`.

### Required GitHub secret

- `NPM_TOKEN`: npm automation token with publish permission for `@fiber-pay/*`

Workflow file: `.github/workflows/release.yml`

### Quick release checklist

- `pnpm changeset`
- `pnpm changeset:version`
- `pnpm typecheck && pnpm test && pnpm build`
- commit and push updated versions/changelogs to `master`
- create and push tag: `vX.Y.Z` (or `vX.Y.Z-rc.N`)
- confirm `Release` workflow passes in GitHub Actions

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
