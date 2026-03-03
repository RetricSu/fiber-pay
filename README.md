# fiber-pay

AI-friendly toolchain for CKB Lightning on Fiber Network.

Fiber target: `v0.7.1`

## Positioning

`fiber-pay` is built to make Fiber programmable for both humans and AI agents:

- `@fiber-pay/sdk`: typed building blocks for Fiber RPC, verification, and policy logic
- `@fiber-pay/cli`: stable operator + automation interface with machine-readable output
- `@fiber-pay/runtime`: orchestration runtime for jobs, monitoring, retries, and proxy-facing automation loops
- `@fiber-pay/node`: easy handling for the local `fnn` binary lifecycle

## Why this repo is AI-friendly

- Canonical skill guide for agents: `skills/fiber-pay/SKILL.md`
- Predictable grouped commands (`node/channel/invoice/payment/job/peer/binary/config/graph/runtime`)
- Uniform `--json` envelopes for reliable parsing and tool chaining
- NDJSON stream events for `watch --json` commands
- Explicit defaults for startup, ports, binary path, and key password behavior

## Copy-paste prompt for your coding agent

Use this prompt in Cursor/Claude/Copilot/other agents:

```text
Follow this document https://raw.githubusercontent.com/RetricSu/fiber-pay/refs/heads/master/skills/fiber-pay/SKILL.md to equip yourself with a p2p payment system. If fiber-pay CLI is not available, install via npm first: npm install -g @fiber-pay/cli@next. Only clone/build this repository when explicitly asked to work on source code.
```

## Human quickstart

If you are operating `fiber-pay` manually (not through an AI agent), start here:

- [docs/human-quickstart.md](docs/human-quickstart.md)

## Development

Please read `docs/develop.md` for details.
