# AGENT.md

Maintainer and coding-agent operating guide for `fiber-pay`.

## Project position (authoritative)

`fiber-pay` is an AI-friendly SDK + CLI for CKB Lightning on Fiber Network (`fnn`).

Protocol target: Fiber `v0.6.1`.

Primary layers in active scope:

- `@fiber-pay/sdk`: typed building blocks for Fiber RPC, verification, and policy logic
- `@fiber-pay/cli`: stable operator + automation interface with machine-readable output
- `@fiber-pay/runtime`: orchestration runtime for jobs, monitoring, retries, and proxy-facing automation loops
- `@fiber-pay/node`: easy handling for the local `fnn` binary lifecycle

## Source-of-truth order

When executing real tasks, follow this order:

1. Read `docs/develop.md` for overall developing guidance on this project
2. `skills/fiber-pay/SKILL.md` and `skills/fiber-pay/references/**` (canonical workflow, architecture, and contracts)
3. code in `packages/cli/src/**` and `packages/sdk/src/**` (authoritative command and behavior details)

If docs and code disagree, treat current code as authoritative and update skills docs accordingly.

## Operating rules for coding agents

1. Read `skills/fiber-pay/SKILL.md` before running `fiber-pay` workflows.
2. Use grouped commands only: `node`, `channel`, `invoice`, `payment`, `peer`, `binary`, `balance`.
3. Use `--json` whenever output is consumed by tools/scripts.
4. Default to single-node startup unless multi-node/custom ports are explicitly requested.
5. For exact syntax and flags, use progressive CLI help (`fiber-pay -h`, subgroup `-h`) and command source code.
6. Do not invent undocumented flags, command aliases, or response schemas.

## Contribution focus

Prioritize improvements that strengthen(in order) SDK -> runtime -> CLI reliability and AI usability:

- stable command semantics
- clear machine-readable outputs
- explicit runtime defaults
- minimal ambiguity in docs/examples

Avoid adding new top-level abstractions unless they are required for SDK/CLI workflows.

## Change checklist

For CLI changes:

1. update command implementation in `packages/cli/src/commands/**`
2. keep output policy consistent (human default + `--json`)
3. update `skills/fiber-pay/SKILL.md` and related `skills/fiber-pay/references/**` docs for workflow/contract changes
4. run:

```bash
pnpm --filter @fiber-pay/cli typecheck
pnpm --filter @fiber-pay/cli build
```

For SDK changes:

1. update types in `packages/sdk/src/types/**` as needed
2. update RPC client or helpers in `packages/sdk/src/**`
3. keep exports consistent in `packages/sdk/src/index.ts`
4. run:

```bash
pnpm --filter @fiber-pay/sdk test
pnpm --filter @fiber-pay/sdk typecheck
```

## Repository-wide validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Release checklist (maintainers)

Tag-based release is authoritative in `.github/workflows/release.yml`.

1. add changeset files during feature/fix PRs:

```bash
pnpm changeset
```

2. before release, consume changesets and update package versions + changelogs:

```bash
pnpm changeset:version
```

3. run repository-wide validation:

```bash
pnpm typecheck
pnpm test
pnpm build
```

4. commit version/changelog updates to `master`, then create and push tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

5. for prerelease tracks, use `vX.Y.Z-rc.N` (published to npm `next` dist-tag).

## Practical notes

- ESM imports require `.js` extension in source imports.
- Fiber RPC amounts are typically hex-encoded shannons at the boundary.
- Apple Silicon may require x86_64 fallback binaries depending on upstream release artifacts.
- In lifecycle code, re-check process/rpc readiness after awaited operations.
