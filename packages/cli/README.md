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

## UDT (User-Defined Token) Support

The CLI supports UDT channels, invoices, payments, and rebalances on Fiber `v0.9.0-rc7`:

```bash
# Open a UDT channel
fiber-pay channel open --peer <addr> --funding <UDT-amount> \
  --funding-udt-type-script '{"code_hash":"0x...","hash_type":"type","args":"0x..."}' --json

# Create a UDT invoice
fiber-pay invoice create --amount <UDT-amount> \
  --udt-type-script '{"code_hash":"0x...","hash_type":"type","args":"0x..."}' --json
fiber-pay invoice create --amount <UDT-amount> --udt-name <name> --json

# Send payment and rebalance work across CKB and UDT channels.
```

See [docs/l402-agent-guide.md](./docs/l402-agent-guide.md) for L402 and agent details.

## Compatibility

- Node.js `>=20`
- Fiber target: `v0.9.0-rc7`

