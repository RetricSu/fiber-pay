# @fiber-pay/cli

Command-line tool for managing Fiber Network nodes.

## Install

```bash
pnpm add @fiber-pay/cli
```

## Usage

```bash
fiber-pay --help
fiber-pay node start --json
fiber-pay l402 proxy --target http://localhost:3000 --price 0.1
fiber-pay agent serve --agent codex --price 0.1
fiber-pay agent call http://host:8402 --prompt "your question"
```

See [docs/l402-agent-guide.md](../../docs/l402-agent-guide.md) for L402 and agent details.

## Compatibility

- Node.js `>=20`
- Fiber target: `v0.7.1`

