# AI Maintainer Governance Runbook

This runbook defines the minimal governance baseline for automated maintainers.

## Objectives

- Keep PR review risk visible and deterministic.
- Enforce human review on potentially breaking changes.
- Keep machine output auditable and reproducible.

## Automated PR Risk Summary

Workflow: `.github/workflows/pr-change-summary.yml`  
Script: `scripts/pr-change-summary.mjs`

Each pull request gets:

- a sticky PR comment with risk summary
- a workflow summary block
- a JSON artifact (`pr-change-summary.json`)

The report includes:

- affected packages
- changed file count
- interface signals
- risk level (`low`, `medium`, `high`) with reasons

## Risk Rubric

### Low

Typical examples:

- docs-only changes
- tests-only changes
- internal refactors without public surface changes

### Medium

Typical examples:

- public entrypoint touched without explicit removals
- package manifest touched with possible surface change
- workflow/runtime proxy contract path changes
- multi-package PRs without direct breaking signals

### High

Typical examples:

- removed export statements in package entrypoints
- public entrypoint file removed or renamed
- CLI command file removed or renamed
- package export contract removal signals

## Required Actions by Risk

- `low`: standard review flow
- `medium`: require explicit reviewer acknowledgment of risk reasons
- `high`: require maintainer approval and rollback notes in PR description

## Rollback Guidance

If a merged PR causes regression:

1. Revert the PR commit(s) first.
2. Re-run CI and confirm green state.
3. Open a follow-up fix PR with narrowed scope.
4. Keep the risk summary artifact for incident context.
