# Development

This document is the single source of truth for project development and maintainer operations (for both human and AI maintainers).

## Table of contents

- [Development](#development)
	- [Table of contents](#table-of-contents)
	- [Prerequisites and baseline checks](#prerequisites-and-baseline-checks)
	- [Maintainer baseline (human + AI)](#maintainer-baseline-human--ai)
	- [Project website and deployment](#project-website-and-deployment)
	- [Required validation policy](#required-validation-policy)
		- [Commit gate (local hook)](#commit-gate-local-hook)
		- [CI gate](#ci-gate)
		- [Changeset CI check](#changeset-ci-check)
	- [Change-scope command matrix](#change-scope-command-matrix)
	- [Release to npm (multi-package)](#release-to-npm-multi-package)
		- [Versioning model](#versioning-model)
		- [Changeset enforcement](#changeset-enforcement)
		- [Release flow](#release-flow)
		- [Notes](#notes)
		- [Required GitHub secret](#required-github-secret)
		- [Quick release checklist](#quick-release-checklist)
	- [Fiber (fnn) version upgrade checklist](#fiber-fnn-version-upgrade-checklist)
	- [Smoke script (no token consumption)](#smoke-script-no-token-consumption)
	- [Canonical E2E script (single entry)](#canonical-e2e-script-single-entry)

## Prerequisites and baseline checks

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

## Project website and deployment

- GitHub Pages landing site: https://retricsu.github.io/fiber-pay/
- Site source: [website/index.html](../website/index.html)
- Deployment workflow: [.github/workflows/pages.yml](../.github/workflows/pages.yml)

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

- `pnpm format:check`
- `pnpm lint`
- `pnpm changeset`
- `pnpm changeset:version`
- `pnpm build && pnpm typecheck && pnpm test`
- commit and push updated versions/changelogs to `master`
- create and push tag: `vX.Y.Z` (or `vX.Y.Z-rc.N`)
- confirm `Release` workflow passes in GitHub Actions

## Fiber (fnn) version upgrade checklist

Version strings are scattered across user-facing text; a plain grep for the old
version is necessary but not sufficient. When bumping the fnn target, walk this
list:

1. **Single source**: `packages/node/src/constants.ts` (`DEFAULT_FIBER_VERSION`).
   Runtime code must interpolate it — never hardcode a version in new messages.
2. **fiber-js dependency**: catalog entry in `pnpm-workspace.yaml` plus any
   `peerDependencies` overrides, then re-resolve the lockfile and diff the
   stable `.d.ts` against the previous rc for WASM API changes.
3. **CLI user-visible text**: `packages/cli/src/commands/node.ts`,
   `packages/cli/src/lib/node-start.ts`, `packages/cli/src/lib/node-upgrade.ts`,
   `packages/cli/src/lib/node-version-policy.ts` — these should all interpolate
   `DEFAULT_FIBER_VERSION`; grep for hardcoded `v0.` remnants anyway.
4. **RPC surface delta** (upstream rpc/README diff between versions): new
   `ChannelState` values → `packages/sdk/src/types/rpc.ts` enum,
   `packages/cli/src/lib/format.ts` (`stateLabel` / `parseChannelState`), and
   the React predicates in `packages/react/src/fiber-node-button/utils.ts`
   (display vs. destructive-operation semantics — a "pending" state that is
   funded must not route to `abandon_channel`); new RPC methods →
   `packages/sdk/src/rpc/client.ts` (decide explicitly whether each belongs on
   the shared `IFiberClient` interface); new response fields → check fan-out
   sinks (runtime alert payloads are field-whitelisted for this reason).
5. **Skill docs**: `skills/fiber-pay/SKILL.md` (description, node target, RPC
   reference link, `Last updated` date) and `skills/fiber-pay/references/*.md`
   runnable examples — historical migration notes keep old versions on purpose,
   copy-paste-runnable examples must not.
6. **Bundle-size notes**: `packages/react/README.md`,
   `packages/sdk/README.md`,
   `packages/react/docs/wasm-passkey-payment-component-quickstart.md` — re-measure
   with the new fiber-js or keep the wording version-agnostic.
7. **Workflows**: `.github/workflows/*smoke*`, `e2e-*` — confirm they pick the
   version up from the constant rather than pinning their own.

## Smoke script (no token consumption)

Use smoke checks for startup/readiness/log health only (no channel open/payment):

```bash
pnpm smoke
```

**For WASM integration:**

```bash
pnpm test:wasm
```

Starts a Vite server to validate the WebAssembly-based Fiber node lifecycle directly within the browser without spinning up local `fnn` binaries. 

*(Note: Both WASM smoke tests and frontend applications require specific Vite plugins like `crossOriginIsolation` to safely enable multithreading `SharedArrayBuffer` features for Tokio runtime execution.)*


Smoke validates:

- node start/stop path (native and wasm)
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
- `FIBER_BINARY_VERSION=v0.9.0`
- `CHANNEL_FUNDING_CKB` (default `200`)
- `INVOICE_AMOUNT_CKB` (default `1`, keep tiny for long-term reuse)
- `MIN_FUNDING_BALANCE_CKB`
- `NODE_A_RPC_PORT`, `NODE_A_P2P_PORT`, `NODE_B_RPC_PORT`, `NODE_B_P2P_PORT`
- `NODE_READY_TIMEOUT_SEC`, `CHANNEL_READY_TIMEOUT_SEC`, `PAYMENT_TIMEOUT_SEC`, `CHANNEL_CLOSE_TIMEOUT_SEC`
- `FIXED_NODE_A_FIBER_SK_HEX`, `FIXED_NODE_B_FIBER_SK_HEX` (optional key override)
- `FIXED_NODE_A_CKB_SK_HEX`, `FIXED_NODE_B_CKB_SK_HEX` (optional key override)
