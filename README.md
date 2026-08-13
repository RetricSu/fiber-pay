# fiber-pay

AI-friendly toolchain for CKB Lightning on Fiber Network.

Fiber target: `v0.9.0`

https://retricsu.github.io/fiber-pay/

## Start Here: CLI + SDK

`fiber-pay` has three primary integration surfaces:

- `@fiber-pay/cli`: operations and automation for humans and agents (profiles, node/channel/payment lifecycle, runtime jobs, L402 proxy, `agent serve` / `agent call`)
- `@fiber-pay/sdk`: application-facing typed APIs (universal + node + browser entrypoints)
- `@fiber-pay/react`: the higher-level React layer built on top of `@fiber-pay/sdk/browser`, intended for fast browser UI integration.

Package maturity note:

- `@fiber-pay/agent` is currently experimental and not recommended for production use yet (limited validation coverage and ongoing hardening).

## Quickstart by Goal

1. Operate Fiber locally (manual workflow): [packages/cli/docs/human-quickstart.md](packages/cli/docs/human-quickstart.md)
2. Build backend/services with SDK: [packages/sdk/README.md](packages/sdk/README.md)
3. Build browser passkey payment UI (React): [packages/react/docs/wasm-passkey-payment-component-quickstart.md](packages/react/docs/wasm-passkey-payment-component-quickstart.md)
4. Expose paid AI endpoints (`agent serve`):
   - [packages/cli/docs/l402-agent-guide.md](packages/cli/docs/l402-agent-guide.md)
   - [packages/cli/docs/agent-serve-frontend-integration.md](packages/cli/docs/agent-serve-frontend-integration.md)
   - [packages/cli/docs/agent-serve-backend-setup.md](packages/cli/docs/agent-serve-backend-setup.md)
   - [packages/cli/docs/boxlite-agent-setup.md](packages/cli/docs/boxlite-agent-setup.md)

## Package Map

| Package | Role |
| --- | --- |
| `@fiber-pay/cli` | Stable operator interface and automation-first command surface |
| `@fiber-pay/sdk` | Typed protocol/client primitives for app integration |
| `@fiber-pay/react` | React hooks/components for browser WASM + passkey payment flows (`ConnectButton`, `FiberNodeButton`, `FiberPayQuickCard`, `NodeInfoPanel`, `useFiberNode`, `useFiberPayment`) |
| `@fiber-pay/runtime` | Runtime orchestration (jobs, monitoring, retry loops) |
| `@fiber-pay/node` | Local `fnn` binary lifecycle management |
| `@fiber-pay/agent` | Experimental package, not recommended for production yet |

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

## SDK demo coverage matrix

The canonical demos are now organized by integration layer under `examples/`:

1. React integration layer (minimal): [examples/react-min-connect](examples/react-min-connect)
2. React component layer (FiberNodeButton): [examples/react-fiber-node-button-lab](examples/react-fiber-node-button-lab)
3. Browser SDK layer (`@fiber-pay/sdk/browser`): [examples/browser-sdk-playground](examples/browser-sdk-playground)
4. Universal SDK layer (`@fiber-pay/sdk` Node recipes): [examples/sdk-node-recipes](examples/sdk-node-recipes)

## Development

Please read `docs/develop.md` for details.
