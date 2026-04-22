# fiber-pay

AI-friendly toolchain for CKB Lightning on Fiber Network.

Fiber target: `v0.8.0`

## Positioning

`fiber-pay` is built to make Fiber programmable for both humans and AI agents:

- `@fiber-pay/sdk`: typed building blocks for Fiber RPC, verification, policy logic, and L402 protocol (now supports native WebAssembly execution in the Browser!)
- `@fiber-pay/react`: one-line React hooks + starter payment component for browser WASM and passkey flows
- `@fiber-pay/cli`: stable operator + automation interface with machine-readable output
- `@fiber-pay/runtime`: orchestration runtime for jobs, monitoring, retries, and proxy-facing automation loops
- `@fiber-pay/node`: easy handling for the local `fnn` binary lifecycle

## Why this repo is AI-friendly

- Canonical skill guide for agents: `skills/fiber-pay/SKILL.md`
- Predictable grouped commands (`node/channel/invoice/payment/job/peer/binary/config/graph/runtime/l402/agent`)
- Uniform `--json` envelopes for reliable parsing and tool chaining
- NDJSON stream events for `watch --json` commands
- Explicit defaults for startup, ports, binary path, and key password behavior
- Dynamic `ConfigBuilder` enabling browser environment node orchestration

## Copy-paste prompt for your coding agent

Use this prompt in Cursor/Claude/Copilot/other agents:

```text
Follow this document https://raw.githubusercontent.com/RetricSu/fiber-pay/refs/heads/master/skills/fiber-pay/SKILL.md to equip yourself with a p2p payment system. If fiber-pay CLI is not available, install via npm first: npm install -g @fiber-pay/cli. Only clone/build this repository when explicitly asked to work on source code.
```

## Human quickstart

If you are operating `fiber-pay` manually (not through an AI agent), start here:

- [docs/human-quickstart.md](docs/human-quickstart.md)

## Browser WASM + Passkey quickstart

Build a browser payment UI component quickly with SDK browser APIs:

- [docs/wasm-passkey-payment-component-quickstart.md](docs/wasm-passkey-payment-component-quickstart.md)

## Agent serve app integration

For external frontend/app projects that call `agent serve` directly:

- [docs/agent-serve-frontend-integration.md](docs/agent-serve-frontend-integration.md)

## Development

Please read `docs/develop.md` for details.
