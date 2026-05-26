# BoxLite Agent Setup Guide

This document focuses on one thing: bringing up a runnable BoxLite environment for `fiber-pay agent serve` from scratch.

For architecture, proxy security model, token/session semantics, and hardening rationale, read [agent-serve-backend-setup.md](./agent-serve-backend-setup.md).

## 1. Platform prerequisites

Supported baseline:

- macOS Apple Silicon (ARM64), macOS 12+
- Linux x86_64/ARM64 with KVM
- Windows x86_64 via WSL2 + KVM

On Linux/WSL2, verify KVM first:

```bash
ls -la /dev/kvm
```

If permissions are missing:

```bash
sudo usermod -aG kvm $USER
```

Then log out and log in again.

## 2. Install boxlite CLI

Option A (recommended on macOS): prebuilt binary

```bash
curl -L -o /tmp/boxlite.tar.gz \
  https://github.com/boxlite-ai/boxlite/releases/download/v0.8.2/boxlite-cli-v0.8.2-aarch64-apple-darwin.tar.gz
tar -xzf /tmp/boxlite.tar.gz -C /tmp
mv /tmp/boxlite ~/.local/bin/boxlite
```

Option B: cargo

```bash
cargo install boxlite-cli
```

Verify:

```bash
boxlite --version
```

## 3. Start BoxLite REST server

```bash
boxlite serve
```

Default endpoint: `http://localhost:8100`

## 4. Create a persistent Box

Use `node:22-alpine` with persistent disk (>= 10 GB).

```bash
curl -X POST http://localhost:8100/v1/default/boxes \
  -H 'Content-Type: application/json' \
  -d '{
    "image": "node:22-alpine",
    "name": "fiber-pay-agent",
    "network": {
      "mode": "enabled",
      "allowNet": [
        "api.openai.com",
        "api.anthropic.com",
        "api.kimi.com",
        "registry.npmjs.org"
      ]
    },
    "env": {
      "NODE_ENV": "production"
    },
    "memory_mib": 1024,
    "disk_size_gb": 10
  }'
```

Start the box:

```bash
curl -X POST http://localhost:8100/v1/default/boxes/fiber-pay-agent/start
```

Security note:

- Prefer no host bind mount.
- If you must mount, use a dedicated least-privilege directory only.

## 5. Install required runtime tools in Box

Install `acpx`:

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- npm install -g acpx@0.5.3
boxlite --url http://localhost:8100 exec fiber-pay-agent -- acpx --version
```

Install OpenCode runtime:

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- apk add gcompat
boxlite --url http://localhost:8100 exec fiber-pay-agent -- npm install -g opencode-ai@latest
boxlite --url http://localhost:8100 exec fiber-pay-agent -- opencode --version
```

If ACP reports `Script not found "acp"` on Alpine, switch to musl binary:

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- sh -c \
  'MUSL_BIN=$(find /usr/local/lib/node_modules/opencode-ai/node_modules -name "opencode" -path "*musl*" | head -1) && \
   cp "$MUSL_BIN" /usr/local/lib/node_modules/opencode-ai/bin/.opencode && \
   chmod +x /usr/local/lib/node_modules/opencode-ai/bin/.opencode'
```

Optional: install other agent CLIs

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- npm install -g @anthropic-ai/claude-code
boxlite --url http://localhost:8100 exec fiber-pay-agent -- npm install -g codex-cli
```

## 6. Start fiber-pay service on host

Start node(s):

```bash
fiber-pay node start --daemon
fiber-pay node start --daemon --profile user
```

Start service:

```bash
export KIMI_API_KEY="sk-kimi-..."
export L402_ROOT_KEY=$(openssl rand -hex 32)

fiber-pay agent serve \
  --agent opencode \
  --price 0.1 \
  --approve-all \
  --host 127.0.0.1 \
  --port 8402 \
  --boxlite-url http://localhost:8100 \
  --boxlite-box-id fiber-pay-agent
```

If payment succeeds but call times out, set proxy host explicitly:

```bash
fiber-pay agent serve \
  --agent opencode \
  --proxy-host-addr <HOST_IP_VISIBLE_FROM_BOX> \
  ...
```

## 7. Smoke test

```bash
fiber-pay agent call --profile user http://127.0.0.1:8402 --prompt "say hello" --timeout 120
```

## 8. Common failures

- Box not found: `curl -s http://localhost:8100/v1/default/boxes`
- ENOSPC during npm install: recreate box with `disk_size_gb: 10`
- BoxLite not reachable: verify `--boxlite-url` and that `boxlite serve` is running

For deeper troubleshooting and security hardening checklists, continue in [agent-serve-backend-setup.md](./agent-serve-backend-setup.md).
