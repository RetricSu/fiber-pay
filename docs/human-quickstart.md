# Human Quickstart

This guide is for human operators using `fiber-pay` manually (not through an AI agent).

## 1) Install CLI

Prerequisite: Node.js `>=20`

```bash
npm install -g @fiber-pay/cli@next
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

This initializes binary/config/key/runtime automatically for first-time local bootstrap.

## 3) Connect peer and open a channel

```bash
fiber-pay peer connect <peer-multiaddr> --json
fiber-pay channel open --peer <peer-address> --funding <CKB> --json
fiber-pay channel watch --until CHANNEL_READY --json
fiber-pay channel list --state ChannelReady --json
```

## 4) Receive then send payment

Create an invoice (receiver side):

```bash
fiber-pay invoice create --amount <CKB> --description "<desc>" --json
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

- `skills/fiber-pay/references/install.md`
- `skills/fiber-pay/references/core-operation.md`
- `skills/fiber-pay/references/profile.md`
