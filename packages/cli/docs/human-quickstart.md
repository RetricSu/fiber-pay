# Human Quickstart

This guide is for human operators using `fiber-pay` manually (not through an AI agent).

## 1) Install CLI

Prerequisite: Node.js `>=20`

```bash
npm install -g @fiber-pay/cli
fiber-pay --version
fiber-pay -h
```

Install from source:

```bash
git clone https://github.com/RetricSu/fiber-pay.git && cd fiber-pay
pnpm install
pnpm build
cd packages/cli && pnpm link --global
```

## 2) Start your local node

```bash
fiber-pay node start --daemon
fiber-pay node ready --json
fiber-pay runtime status --json
```

> **Note**: For configuring the keystore password, please refer to the [Password Management Guide](../../../skills/fiber-pay/references/password-management.md).

This initializes binary/config/key/runtime automatically for first-time local bootstrap.

This quickstart assumes the default profile-managed binary path. If you set `--binary-path` (or profile `binaryPath`), `node start` uses your binary as-is and `node upgrade` becomes migration-first (migrate-only for custom binaries).

See details:

- [Profile & Multi-Node Guide](../../../skills/fiber-pay/references/profile.md)
- [Upgrade & Migration](../../../skills/fiber-pay/references/upgrade.md)

## 3) Connect peer and open a channel

```bash
fiber-pay peer connect <peer-multiaddr> --json
fiber-pay channel open --peer <peer-address> --funding <CKB> --json
fiber-pay channel watch --until CHANNEL_READY --json
fiber-pay channel list --state CHANNEL_READY --json
```

To open a UDT channel, add `--funding-udt-type-script` with the CKB type script JSON and provide the funding amount as raw UDT units:

```bash
fiber-pay channel open \
  --peer <peer-address> \
  --funding <UDT-amount> \
  --funding-udt-type-script '{"code_hash":"0x...","hash_type":"type","args":"0x..."}' \
  --json
```

## 4) Receive then send payment

Create an invoice (receiver side):

```bash
fiber-pay invoice create --amount <CKB> --description "<desc>" --json
```

Create a UDT invoice by configured name or type script:

> **Note:** UDT amounts are raw integer units (smallest decimal precision). If both `--udt-name` and `--udt-type-script` are provided, the type script takes precedence. Verify the type script against the token issuer's official deployment before accepting payment.

```bash
fiber-pay invoice create --amount <UDT-amount> --udt-name <name> --json
fiber-pay invoice create --amount <UDT-amount> \
  --udt-type-script '{"code_hash":"0x...","hash_type":"type","args":"0x..."}' --json
```

Pay an invoice (sender side):

```bash
fiber-pay payment send <invoice> --wait --json
```

Track status:

```bash
fiber-pay invoice list --json
fiber-pay job list --json
```

## 5) Common troubleshooting

```bash
fiber-pay node ready --json
fiber-pay runtime status --json
fiber-pay channel list --json
fiber-pay logs --source all --tail 120
```

For deeper operator docs, see:

- [install.md](../../../skills/fiber-pay/references/install.md)
- [core-operation.md](../../../skills/fiber-pay/references/core-operation.md)
- [profile.md](../../../skills/fiber-pay/references/profile.md)
