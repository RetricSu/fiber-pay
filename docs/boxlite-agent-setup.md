# BoxLite Agent Setup Guide

This guide walks you through manually configuring [BoxLite](https://github.com/boxlite-ai/boxlite) to securely run `fiber-pay agent serve` inside a hardware-isolated sandbox, based on real deployment experience with BoxLite 0.8.2 on macOS Apple Silicon.

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

**Option A: Download prebuilt binary (fastest, recommended for macOS)**

```bash
curl -L -o /tmp/boxlite.tar.gz \
  https://github.com/boxlite-ai/boxlite/releases/download/v0.8.2/boxlite-cli-v0.8.2-aarch64-apple-darwin.tar.gz
tar -xzf /tmp/boxlite.tar.gz -C /tmp
mv /tmp/boxlite ~/.local/bin/boxlite
```

**Option B: Cargo install**

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

Create a Box using the `node:22-alpine` image with a **persistent disk**. The default ephemeral rootfs is only ~223 MB, which is not enough to install `acpx`, `opencode-ai`, and their dependencies.

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
        "generativelanguage.googleapis.com",
        "registry.npmjs.org",
        "api.kimi.com",
        "opencode.ai",
        "raw.githubusercontent.com",
        "github.com",
        "duckduckgo.com",
        "lite.duckduckgo.com",
        "html.duckduckgo.com",
        "google.com",
        "www.google.com",
        "bing.com",
        "www.bing.com",
        "search.brave.com",
        "api.tavily.com",
        "serpapi.com",
        "en.wikipedia.org",
        "zh.wikipedia.org",
        "developer.mozilla.org",
        "docs.python.org",
        "docs.rs",
        "nodejs.org",
        "docs.npmjs.com",
        "docs.github.com",
        "stackoverflow.com",
        "stackexchange.com",
        "reddit.com",
        "medium.com",
        "dev.to"
      ]
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
    },
    "memory_mib": 1024,
    "disk_size_gb": 10
  }'
```

Example response:

```json
{
  "box_id": "01JST8XAMPLE",
  "name": "fiber-pay-agent",
  "status": "configured",
  "image": "node:22-alpine"
}
```

Start the Box:

```bash
curl -X POST http://localhost:8100/v1/default/boxes/fiber-pay-agent/start
```

> **Note**: The examples below use `BOX_ID` to refer to your box ID. If you named the Box `fiber-pay-agent`, you can use the name directly in the REST API paths.

## Install acpx inside the Box

The agent service requires [acpx](https://github.com/openclaw/acpx) to be installed globally inside the Box. `acpx` 0.5.3+ requires Node.js >= 22.12.0, which is why we use `node:22-alpine` above.

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "npm",
    "args": ["install", "-g", "acpx@0.5.3"]
  }'
```

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

Install the specific agent CLI you plan to expose.

### OpenCode agent

The OpenCode CLI is distributed as `opencode-ai` on npm. On Alpine Linux (musl libc), you also need `gcompat` to run the prebuilt binary.

**Step 1: Install gcompat**

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "apk",
    "args": ["add", "gcompat"]
  }'
```

**Step 2: Install opencode-ai**

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "npm",
    "args": ["install", "-g", "opencode-ai@latest"]
  }'
```

**Step 3: Fix the binary (Alpine / musl only)**

BoxLite 0.8.2 on Alpine may install a glibc-linked `opencode-linux-arm64` binary that silently fails. Verify the actual version inside the Box:

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "opencode",
    "args": ["--version"]
  }'
```

If it reports **1.3.11** instead of **1.4.6**, or if `acpx opencode exec` later fails with `Script not found "acp"`, manually replace the cached binary with the musl build:

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "sh",
    "args": ["-c", "cp /usr/local/lib/node_modules/opencode-ai/node_modules/opencode-linux-arm64-musl/bin/opencode /usr/local/lib/node_modules/opencode-ai/bin/.opencode && chmod +x /usr/local/lib/node_modules/opencode-ai/bin/.opencode"]
  }'
```

### Claude agent

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "npm",
    "args": ["install", "-g", "@anthropic-ai/claude-code"]
  }'
```

### Codex agent

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "npm",
    "args": ["install", "-g", "codex-cli"]
  }'
```

## Copy local agent configuration into the Box

If you have local agent configuration files (e.g. for OpenCode), copy them into the Box so the agent behaves the same way as on your host machine.

For OpenCode, the config lives at `~/.config/opencode/` on your host. Copy both `opencode.json` and `oh-my-openagent.json` into the Box for both `/root` and `/home/boxlite`:

```bash
# Create directories
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "mkdir",
    "args": ["-p", "/root/.config/opencode", "/home/boxlite/.config/opencode"]
  }'

# Write opencode.json (repeat for oh-my-openagent.json)
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "sh",
    "args": ["-c", "cat > /root/.config/opencode/opencode.json << 'EOF'\n{ ...your opencode.json content... }\nEOF"]
  }'
```

> **Tip**: It is easiest to write the files using a heredoc inside an `sh -c` exec, as shown above.

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
      "registry.npmjs.org",
      "api.kimi.com",
      "opencode.ai",
      "raw.githubusercontent.com",
      "github.com",
      "duckduckgo.com",
      "lite.duckduckgo.com",
      "html.duckduckgo.com",
      "google.com",
      "www.google.com",
      "bing.com",
      "www.bing.com",
      "search.brave.com",
      "api.tavily.com",
      "serpapi.com",
      "en.wikipedia.org",
      "zh.wikipedia.org",
      "developer.mozilla.org",
      "docs.python.org",
      "docs.rs",
      "nodejs.org",
      "docs.npmjs.com",
      "docs.github.com",
      "stackoverflow.com",
      "stackexchange.com",
      "reddit.com",
      "medium.com",
      "dev.to"
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

## Start the Fiber node

Before starting `agent serve`, make sure a local Fiber node is running so it can create L402 payment challenges. The default profile uses RPC `127.0.0.1:8227`:

```bash
fiber-pay node start --daemon
```

If you plan to call the agent with a different profile (e.g. `user`), start that profile's node too:

```bash
fiber-pay node start --daemon --profile user
```

## Start fiber-pay agent serve

From your **host machine** (outside the Box), start `fiber-pay agent serve`. Use the new BoxLite-specific CLI options to declare which Box the agent should run in.

```bash
export L402_ROOT_KEY=$(openssl rand -hex 32)
fiber-pay agent serve \
  --agent opencode \
  --price 0.1 \
  --approve-all \
  --boxlite-url http://localhost:8100 \
  --boxlite-box-id fiber-pay-agent \
  --port 8402
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

## Call the agent

From another terminal, use `fiber-pay agent call` to test the service. If you started a separate Fiber node for the `user` profile, pass `--profile user` so the CLI can auto-pay the L402 invoice:

```bash
fiber-pay agent call --profile user http://127.0.0.1:8402 --prompt "say hello" --timeout 120
```

The call will:
1. Receive a `402 Payment Required` challenge
2. Pay the invoice via the `user` profile's Fiber node
3. Retry the request with the L402 token
4. Return the agent's response from the BoxLite sandbox

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

### "No space left on device" (ENOSPC) during npm install

The default Box rootfs is only ~223 MB. You must create the Box with a persistent disk:

```json
"disk_size_gb": 10
```

If you already created the Box without a disk, delete it and recreate it with `disk_size_gb` set.

### "Node.js version too old" when installing acpx

`acpx` 0.5.3+ requires Node.js >= 22.12.0. Use `node:22-alpine` (or newer) when creating the Box.

### acpx is not installed

If `fiber-pay agent serve` exits with an acpx error, install it inside the Box:

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "npm",
    "args": ["install", "-g", "acpx@0.5.3"]
  }'
```

### opencode fails with "Script not found 'acp'"

This happens when the wrong platform binary is active (the glibc `opencode-linux-arm64` binary on Alpine). Fix it by manually copying the musl binary:

```bash
curl -X POST http://localhost:8100/v1/default/boxes/BOX_ID/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "command": "sh",
    "args": ["-c", "cp /usr/local/lib/node_modules/opencode-ai/node_modules/opencode-linux-arm64-musl/bin/opencode /usr/local/lib/node_modules/opencode-ai/bin/.opencode && chmod +x /usr/local/lib/node_modules/opencode-ai/bin/.opencode"]
  }'
```

### Agent CLI not found

If the agent execution fails with "command not found", install the specific agent CLI inside the Box (see [Install agent CLIs](#install-agent-clis)).

### Network requests time out inside the Box

Check your `allowNet` list. The target domain must be explicitly allowed. Also verify that `localhost` and `127.0.0.1` are **not** present in `allowNet`.

### fiber-pay cannot connect to BoxLite

Confirm the `--boxlite-url` matches the address where `boxlite serve` is listening. If BoxLite is running on a different host or port, update the flag or the `BOXLITE_URL` environment variable.

### opencode agent returns 502 after payment

If you see `ACP agent exited before initialize completed`, this is usually an intermittent issue caused by the opencode ACP server failing to initialize inside the BoxLite VM. Try:

1. Calling the agent again (it often succeeds on the second attempt)
2. Restarting `agent serve`
3. Switching to a different agent such as `codex` if the problem persists
