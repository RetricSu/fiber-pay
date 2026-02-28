# AI Payment Layer Intent (Agreed Baseline)

Last updated: 2026-02-12
Status: agreed for documentation alignment and upcoming refactor planning

## Why this exists

This document captures the agreed project intent before deeper refactors.
It is the baseline for updating root docs and guiding `@fiber-pay/agent` evolution.

## Core intent

fiber-pay is an **AI payment layer** on top of Fiber Network (target: `v0.7.1`).

The repository also exposes `sdk / node / cli` as foundational capabilities so the payment layer is practical to build, run, and debug.

## Package role model

- `@fiber-pay/sdk`: protocol and domain primitives (RPC client, types, validation/security helpers)
- `@fiber-pay/node`: binary and process lifecycle substrate
- `@fiber-pay/cli`: operator-facing command surface and troubleshooting workflows
- `@fiber-pay/agent`: LLM-facing orchestration and governance layer

## `@fiber-pay/agent` target role (north star)

`@fiber-pay/agent` should be treated as orchestration runtime, not a thin RPC passthrough.

It is expected to provide:

1. intent-to-action orchestration for payment workflows
2. policy and safety guardrails in decision path
3. stateful execution for long-running flows (payment/channel readiness/hold-invoice lifecycle)
4. standardized result contract for LLM/tooling integration
5. first-class observability and auditability

## Current gap statement

Current `@fiber-pay/agent` implementation is functional but **not fully aligned** with the target role above.

A focused refactor is required later. That refactor is intentionally deferred until documentation alignment is complete.

## Scope and sequencing decision

1. First: align project intent in root docs (`README.md`, `docs/develop.md`)
2. Next: continue documentation cleanup against this baseline
3. Later: execute `@fiber-pay/agent` structural refactor
4. Last: refresh skill docs after core docs and architecture intent are stable

## Priority override (new)

For `@fiber-pay/agent` planning:

- MCP runtime support is deferred indefinitely.
- Skill-facing usability and documentation are higher priority than MCP expansion.
- Agent refactor scope should avoid adding new MCP runtime commitments unless this decision is explicitly revisited.

## Decision guardrails

When in doubt during implementation or documentation changes:

- prefer AI payment layer framing over package-centric framing
- avoid over-promising agent-runtime capabilities not yet implemented
- keep Fiber `v0.7.1` compatibility explicit in behavior docs
- use grouped CLI command model consistently
