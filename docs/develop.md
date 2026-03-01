# Development

This document is the single source of truth for project development and maintainer operations (for both human and AI maintainers).

Prerequisites:

- Node.js `>=20`
- `pnpm`

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm build
pnpm typecheck
pnpm test
```

## Maintainer baseline (human + AI)

Always follow these rules for any change:

1. Use this document as the canonical maintainer guide.
2. Prefer `--json` output for CLI/runtime automation flows.
3. Keep command semantics stable; do not introduce undocumented flags.
4. If docs and code disagree, treat current code behavior as authoritative, then update docs.

## Required validation policy

### Commit gate (local hook)

Every commit must pass local hook checks:

- staged file autofix/check: `pnpm lint-staged`
- repository format check: `pnpm format:check`
- repository lint check: `pnpm lint`
- repository build check: `pnpm build`
- repository type check: `pnpm typecheck`
- repository test check: `pnpm test`

### CI gate

CI remains the remote enforcement gate and must stay aligned with local checks.

### Changeset CI check

Every pull request is checked for a changeset file by `.github/workflows/changeset-check.yml`. See the [Changeset enforcement](#changeset-enforcement) section for details on when this check applies and how to bypass it.

## Change-scope command matrix

- Docs-only changes: `pnpm format:check`
- Single-package source changes: run package-scoped checks + `pnpm lint`
- Cross-package source changes: `pnpm format:check && pnpm lint && pnpm build && pnpm typecheck && pnpm test`
- Release changes: full cross-package checks + release checklist below

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

### Changeset enforcement

A CI check (`.github/workflows/changeset-check.yml`) runs on every PR:

- **Fails** if the PR touches package code but contains no `.changeset/*.md` file.
- Posts a bot comment reminding the author to run `pnpm changeset`.
- For docs-only, CI, or chore PRs that need no version bump, add the `skip-changeset` label to bypass the check.

### Release flow

1. Add a changeset after code changes:

```bash
pnpm changeset
```

1. Keep prerelease (`rc`) mode when needed:

```bash
pnpm changeset pre enter rc
```

1. Consume changesets, bump versions, and generate changelogs:

```bash
pnpm changeset:version
```

1. Commit and push version/changelog changes to `master`.

1. Create and push a release tag (or create a GitHub Release with that tag):

```bash
git tag v0.1.1
git push origin v0.1.1
```

For prerelease:

```bash
git tag v0.1.2-rc.1
git push origin v0.1.2-rc.1
```

1. Exit prerelease mode when preparing stable releases:

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

- `pnpm format:check`
- `pnpm lint`
- `pnpm changeset`
- `pnpm changeset:version`
- `pnpm build && pnpm typecheck && pnpm test`
- commit and push updated versions/changelogs to `master`
- create and push tag: `vX.Y.Z` (or `vX.Y.Z-rc.N`)
- confirm `Release` workflow passes in GitHub Actions

## Smoke script (no token consumption)

Use smoke checks for startup/readiness/log health only (no channel open/payment):

```bash
pnpm smoke
```

Smoke validates:

- node start/stop path
- runtime start/stop path
- persisted fnn/runtime logs availability
- key/bootstrap integrity in temporary data dir

## Canonical E2E script (single entry)

Use one end-to-end script for fixed, pre-funded nodes:

```bash
pnpm e2e
```

The script validates this full flow: peer connect → channel open → tiny payment → cooperative close.

By default, the script uses embedded fixed testnet keys for both nodes (no required env input), so GitHub Actions can run with one click.

Built-in fixed node identities:

- Node A ID: `0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798`
- Node B ID: `02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5`

Built-in fixed funding addresses (testnet):

- Node A funding address: `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqt2zn2dwwrgu7hvd5r8mts9kd07q5352mcw5mlhc`
- Node B funding address: `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwt94k20mrfcps0jh942clrm6sc3sqqtdslt6u0e`

One-time top-up example:

```bash
offckb deposit --network testnet ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqt2zn2dwwrgu7hvd5r8mts9kd07q5352mcw5mlhc 300
offckb deposit --network testnet ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwt94k20mrfcps0jh942clrm6sc3sqqtdslt6u0e 300
```

Recommended env (fixed pre-funded profiles):

- `NODE_A_DIR` (default `~/.fiber-pay/profiles/e2e-a`)
- `NODE_B_DIR` (default `~/.fiber-pay/profiles/e2e-b`)

Useful env overrides:

- `SKIP_BUILD=1`
- `SKIP_BINARY_DOWNLOAD=1`
- `FIBER_BINARY_VERSION=v0.7.1`
- `CHANNEL_FUNDING_CKB` (default `200`)
- `INVOICE_AMOUNT_CKB` (default `1`, keep tiny for long-term reuse)
- `MIN_FUNDING_BALANCE_CKB`
- `NODE_A_RPC_PORT`, `NODE_A_P2P_PORT`, `NODE_B_RPC_PORT`, `NODE_B_P2P_PORT`
- `NODE_READY_TIMEOUT_SEC`, `CHANNEL_READY_TIMEOUT_SEC`, `PAYMENT_TIMEOUT_SEC`, `CHANNEL_CLOSE_TIMEOUT_SEC`
- `FIXED_NODE_A_FIBER_SK_HEX`, `FIXED_NODE_B_FIBER_SK_HEX` (optional key override)
- `FIXED_NODE_A_CKB_SK_HEX`, `FIXED_NODE_B_CKB_SK_HEX` (optional key override)
