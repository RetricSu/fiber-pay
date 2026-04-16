# BoxLite Agent Setup Guide

This guide walks you through manually configuring [BoxLite](https://github.com/boxlite-ai/boxlite) to securely run `fiber-pay agent serve` inside a hardware-isolated sandbox.

## Prerequisites

Before you begin, make sure your platform supports BoxLite:

| Platform | Architecture | Requirements |
|----------|--------------|--------------|
| macOS | Apple Silicon (ARM64) | macOS 12 or later |
| Linux | x86_64 | KVM enabled (`/dev/kvm` accessible by your user) |
| Linux | ARM64 | KVM enabled (`/dev/kvm` accessible by your user) |
| Windows | x86_64 | WSL2 with KVM support, user in `kvm` group |

### Check KVM permissions (Linux / WSL2)

```bash
ls -la /dev/kvm
```

If you see permission errors, add your user to the `kvm` group and log out:

```bash
sudo usermod -aG kvm $USER
```

## Install boxlite-cli

BoxLite provides a Rust CLI. Install it with Cargo:

```bash
cargo install boxlite-cli
```

Verify the installation:

```bash
boxlite --version
```

## Start BoxLite server

Start the local BoxLite REST API server:

```bash
boxlite serve
```

You should see:

```
Listening on 0.0.0.0:8100
```

The server runs in the foreground. Leave this terminal open, or run it inside a tmux/screen session.

## Create a Box

Create a Box using the `node:20-alpine` image. The following curl command configures networking, a workspace volume, and environment variables.

```bash
curl -X POST http://localhost:8100/v1/default/boxes \
  -H 'Content-Type: application/json' \
  -d '{
    "image": "node:20-alpine",
    "name": "fiber-pay-agent",
    "network": {
      "mode": "enabled",
      "allowNet": ["api.openai.com", "api.anthropic.com", "registry.npmjs.org"]
    },
    "volumes": [
      {
        "source": "./agent-workspace",
        "destination": "/workspace",
        "mode": "rw"
      }
    ],
    "env": {
      "NODE_ENV": "production"
    }
  }'
```

Example response:

```json
{
  "id": "01JST8XAMPLE",
  "name": "fiber-pay-agent",
  "status": "configured",
  "image": "node:20-alpine"
}
```

> **Note**: Save the `id` value. The examples below use `BOX_ID` to refer to this value.

## Install acpx inside the Box

The agent service requires [acpx](https://github.com/openclaw/acpx) to be installed globally inside the Box.

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "npm",
    "args": ["install", "-g", "acpx"]
  }'
```

Replace `BOX_ID` with the actual box ID returned during creation.

Wait for the execution to complete, then verify:

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "acpx",
    "args": ["--version"]
  }'
```

## Install agent CLIs

Install the specific agent CLI you plan to expose. Here are common examples:

**OpenCode agent:**

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "npm",
    "args": ["install", "-g", "@opencode/cli"]
  }'
```

**Claude agent:**

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "npm",
    "args": ["install", "-g", "@anthropic-ai/claude-code"]
  }'
```

**Codex agent:**

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "npm",
    "args": ["install", "-g", "codex-cli"]
  }'
```

## Configure network isolation

BoxLite network isolation is controlled through the `allowNet` field. Only domains listed here are reachable from inside the Box.

> **SECURITY WARNING**
>
> **NEVER** include `localhost`, `127.0.0.1`, or any internal IP address in `allowNet`. Doing so would allow the Box to reach your host machine, including your Fiber RPC endpoint, which defeats the purpose of sandboxing.

A safe `allowNet` configuration for an AI agent Box looks like this:

```json
{
  "network": {
    "mode": "enabled",
    "allowNet": [
      "api.openai.com",
      "api.anthropic.com",
      "generativelanguage.googleapis.com",
      "registry.npmjs.org"
    ]
  }
}
```

Add only the exact API endpoints your agent needs. If you are unsure of a domain, leave it out and test the agent. Add domains one at a time until the agent works.

## Configure environment variables

Agent API keys belong inside the Box environment. Fiber secrets must **never** be passed to the Box.

Set agent keys using the BoxLite exec API or by recreating the Box with an updated `env` object.

**Example: set `OPENAI_API_KEY` via exec**

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "sh",
    "args": ["-c", "echo export OPENAI_API_KEY=sk-your-openai-key >> /etc/profile"]
  }'
```

Replace `sk-your-openai-key` with your actual OpenAI API key.

> **SECURITY WARNING**
>
> Only agent API keys (such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY`) should live inside the Box. **Never** pass Fiber node secrets, macaroon root keys, or RPC credentials into the Box environment.

## Start fiber-pay

From your **host machine** (outside the Box), start `fiber-pay agent serve`. Use the new BoxLite-specific CLI options to declare which Box the agent should run in.

```bash
fiber-pay agent serve \
  --agent opencode \
  --price 0.1 \
  --root-key $(openssl rand -hex 32) \
  --approve-all \
  --boxlite-url http://localhost:8100 \
  --boxlite-box-id fiber-pay-agent
```

### New CLI options explained

| Option | Default | Description |
|--------|---------|-------------|
| `--boxlite-url <url>` | `http://localhost:8100` | BoxLite REST API endpoint |
| `--boxlite-box-id <id>` | `fiber-pay-agent` | Box ID or name where the agent runs |

You can also set these via environment variables:

```bash
export BOXLITE_URL=http://localhost:8100
export BOXLITE_BOX_ID=fiber-pay-agent
```

The service listens on `http://127.0.0.1:8402` by default. Change the port with `--port` if needed.

## Troubleshooting

### "Box not found" errors

Make sure you replaced `BOX_ID` with the actual ID returned when the Box was created. You can list all Boxes to double-check:

```bash
curl -s http://localhost:8100/v1/default/boxes
```

### BoxLite server is not running

If curl returns `Connection refused`, start the server:

```bash
boxlite serve
```

### acpx is not installed

If `fiber-pay agent serve` exits with an acpx error, install it inside the Box:

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "npm",
    "args": ["install", "-g", "acpx"]
  }'
```

### Agent CLI not found

If the agent execution fails with "command not found", install the specific agent CLI inside the Box (see [Install agent CLIs](#install-agent-clis)).

### Network requests time out inside the Box

Check your `allowNet` list. The target domain must be explicitly allowed. Also verify that `localhost` and `127.0.0.1` are **not** present in `allowNet`.

### fiber-pay cannot connect to BoxLite

Confirm the `--boxlite-url` matches the address where `boxlite serve` is listening. If BoxLite is running on a different host or port, update the flag or the `BOXLITE_URL` environment variable.
