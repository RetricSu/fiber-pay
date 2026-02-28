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

### PR risk summary gate

Every pull request is evaluated by a deterministic risk summary workflow:

- workflow: `.github/workflows/pr-change-summary.yml`
- script: `scripts/pr-change-summary.mjs`
- outputs: PR comment + workflow summary + JSON artifact (`pr-change-summary.json`)

The report includes: affected packages, changed file count, interface signals, and risk level with reasons.

Risk rubric:

| Level | Typical examples |
|-------|------------------|
| low | docs-only, tests-only, internal refactors without public surface changes |
| medium | public entrypoint touched without removals, package manifest change, workflow change, multi-package PR |
| high | removed exports in entrypoints, public entrypoint removed/renamed, CLI command file removed/renamed |

Required actions by risk:

- `low` — standard review flow.
- `medium` — reviewer must acknowledge risk reasons.
- `high` — maintainer approval required; rollback notes must be in PR description.

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
