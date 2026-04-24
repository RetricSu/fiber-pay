# BoxLite Agent Setup Guide

This guide walks you through manually configuring [BoxLite](https://github.com/boxlite-ai/boxlite) to securely run `fiber-pay agent serve` inside a hardware-isolated sandbox, based on real deployment experience with BoxLite 0.8.2 on macOS Apple Silicon.

## TL;DR (Server Quickstart)

If you are deploying on a fresh server and want the shortest path to a working setup:

1. Start BoxLite (`boxlite serve`).
2. Create a persistent Box (`node:22-alpine`, disk >= 10 GB).
3. Install runtime tools in the Box:
   - `acpx@0.5.3`
   - `opencode-ai@latest`
   - `gcompat` (Alpine)
4. Verify `opencode --version` in the Box and fix to musl binary if ACP is broken.
5. Start Fiber node(s) on host (`fiber-pay node start --daemon`).
6. Start `fiber-pay agent serve` on host with BoxLite flags.
7. Verify with `fiber-pay agent call` from a separate profile/node.

Minimal service start example:

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
  --boxlite-box-id fiber-pay-agent \
  --timeout 180
```

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

Security recommendation:

- Prefer **not** mounting host directories into the Box. Rely on the Box persistent disk instead.
- Host bind mounts significantly increase blast radius if the sandbox is misconfigured or compromised.
- Never mount repository root, user home, or sensitive system paths.

Forbidden mount sources (examples):

- `.` / project root (for example `~/code/fiber-pay`)
- `$HOME` / user home (for example `/Users/alice`)
- system and secret paths (for example `/etc`, `/var/lib`, `~/.ssh`, cloud credentials dirs)

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
    "env": {
      "NODE_ENV": "production"
    },
    "memory_mib": 1024,
    "disk_size_gb": 10
  }'
```

If you must mount a host directory (for explicit file exchange), enforce minimum privilege:

1. Use a dedicated empty directory only for agent exchange (for example `/var/lib/fiber-pay/agent-workspace`).
2. Do not reuse repository, home, or shared developer directories.
3. Restrict host permissions to the service user.
4. Mount read-only when possible.

Example (only when required):

```json
"volumes": [
  {
    "source": "/var/lib/fiber-pay/agent-workspace",
    "destination": "/workspace",
    "mode": "rw"
  }
]
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

Use the `boxlite` CLI to run commands inside the Box:

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- npm install -g acpx@0.5.3
```

Wait for the execution to complete, then verify:

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- acpx --version
```

## Install agent CLIs

Install the specific agent CLI you plan to expose.

### OpenCode agent

The OpenCode CLI is distributed as `opencode-ai` on npm. On Alpine Linux (musl libc), you also need `gcompat` to run the prebuilt binary.

**Step 1: Install gcompat**

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- apk add gcompat
```

**Step 2: Install opencode-ai**

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- npm install -g opencode-ai@latest
```

**Step 3: Fix the binary (Alpine / musl only)**

BoxLite 0.8.2 on Alpine may install a glibc-linked binary that silently fails. Verify the actual version inside the Box:

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- opencode --version
```

If it reports an old version (for example **1.3.11**) or if `acpx opencode exec` later fails with `Script not found "acp"`, manually replace the cached binary with the musl build:

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- sh -c \
  'MUSL_BIN=$(find /usr/local/lib/node_modules/opencode-ai/node_modules -name "opencode" -path "*musl*" | head -1) && \
   cp "$MUSL_BIN" /usr/local/lib/node_modules/opencode-ai/bin/.opencode && \
   chmod +x /usr/local/lib/node_modules/opencode-ai/bin/.opencode'
```

### Claude agent

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- npm install -g @anthropic-ai/claude-code
```

### Codex agent

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- npm install -g codex-cli
```

## Copy local agent configuration into the Box

If you have local agent configuration files (e.g. for OpenCode), copy them into the Box so the agent behaves the same way as on your host machine.

For OpenCode, the config lives at `~/.config/opencode/` on your host. Copy both `opencode.json` and `oh-my-openagent.json` into the Box:

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- mkdir -p /root/.config/opencode

# Write opencode.json via heredoc
boxlite --url http://localhost:8100 exec fiber-pay-agent -- sh -c \
  "cat > /root/.config/opencode/opencode.json << 'EOF'
{ ...your opencode.json content... }
EOF"

# Repeat for oh-my-openagent.json if you have one
boxlite --url http://localhost:8100 exec fiber-pay-agent -- sh -c \
  "cat > /root/.config/opencode/oh-my-openagent.json << 'EOF'
{ ...your oh-my-openagent.json content... }
EOF"
```

> **Tip**: It is easiest to write the files using a heredoc inside an `sh -c` exec, as shown above.
>
> **Warning**: `boxlite cp` can sometimes create a directory instead of a plain file at the destination (e.g. `opencode.json/`). If you use `boxlite cp`, verify the result with `ls -la` inside the Box and prefer the heredoc method if you hit this issue.

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

### Strict allowNet templates (recommended)

If your goal is stronger egress control and you run in proxy mode (recommended), start with a proxy-only allow list and expand only when requests fail.

Proxy mode minimum (production):

```json
{
  "network": {
    "mode": "enabled",
    "allowNet": [
      "<PROXY_HOST_ADDR>"
    ]
  }
}
```

Examples for `<PROXY_HOST_ADDR>`:

- `192.168.10.152` (host LAN IP)
- `host.docker.internal` (Docker Desktop style setups)

If you need first-run package bootstrap in-box, temporarily add only the npm registry and remove it after prewarm:

```json
{
  "network": {
    "mode": "enabled",
    "allowNet": [
      "<PROXY_HOST_ADDR>",
      "registry.npmjs.org"
    ]
  }
}
```

Direct provider domains are needed only if you intentionally bypass proxy mode:

- Codex/OpenAI: `api.openai.com`
- Claude/Anthropic: `api.anthropic.com`
- Kimi: `api.kimi.com`

Avoid broad search/documentation domains in production unless your agent truly requires web browsing.

## Configure environment variables

Agent API keys belong inside the Box environment. Fiber secrets must **never** be passed to the Box.

**Recommended approach**: If your local agent configuration already includes provider authentication (e.g. `~/.config/opencode/opencode.json` and `oh-my-openagent.json`), copy those config files into the Box instead of embedding raw API keys into environment variables or `/etc/profile`. This avoids leaking secrets in shell history and process listings.

If you still need to set a key via environment, use the BoxLite exec API:

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- sh -c \
  'echo export OPENAI_API_KEY=sk-your-openai-key >> /etc/profile'
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
  --host 0.0.0.0 \
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

### Proxy host address note (important for VMs/containers)

`agent serve` auto-detects the host address used by the Box-side proxy path.
In most environments, auto-detection is correct.

If payment succeeds but requests later time out, the Box may not be able to reach the detected host address. In this case, set a reachable address explicitly:

```bash
fiber-pay agent serve \
  --agent opencode \
  --proxy-host-addr <HOST_IP_VISIBLE_FROM_BOX> \
  ...
```

Do not hardcode `10.0.2.2` unless you have confirmed your runtime topology uses it.

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

### Payment succeeds but response times out

Common causes:

1. Box cannot reach host proxy address.
  - Fix: set `--proxy-host-addr` to an IP visible from inside the Box.
2. OpenCode cold start or stale processes.
  - Fix: restart `agent serve` (startup prewarm will run again).
3. Provider config mismatch.
  - Fix: inspect `/home/boxlite/.config/opencode/opencode.json` in the Box.

Proxy reachability check from inside the Box:

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- sh -lc \
  'HTTP_PROXY=http://<HOST_IP>:8111 HTTPS_PROXY=http://<HOST_IP>:8111 npm view opencode-ai version'
```

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
boxlite --url http://localhost:8100 exec fiber-pay-agent -- npm install -g acpx@0.5.3
```

### opencode fails with "Script not found 'acp'"

This happens when the wrong platform binary is active (the glibc binary on Alpine). Fix it by manually copying the musl binary:

```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- sh -c \
  'MUSL_BIN=$(find /usr/local/lib/node_modules/opencode-ai/node_modules -name "opencode" -path "*musl*" | head -1) && \
   cp "$MUSL_BIN" /usr/local/lib/node_modules/opencode-ai/bin/.opencode && \
   chmod +x /usr/local/lib/node_modules/opencode-ai/bin/.opencode'
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

### Warning: No provider API keys found for proxy injection

This warning means host process environment does not contain supported provider keys at startup (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `KIMI_API_KEY`, or fallback `OPENCODE_API_KEY`).

Behavior is intentional:

- service keeps running
- existing in-Box OpenCode config is preserved
- proxy key-shim is not configured for missing providers

If you expect Kimi through proxy, export `KIMI_API_KEY` before starting service.

### Output appears truncated in frontend

Two separate issues can look similar:

1. Transport-side truncation (fixed in current CLI)
  - BoxLite stream can flush stdout frames after an `exit` frame.
  - Runtime now consumes the full response body before finishing.
2. Rendering-side truncation
  - OpenCode output may contain text markers like `[thinking]` and `[done] end_turn`.
  - Frontend should not treat inline `[done]` text as protocol EOF.
  - In SSE mode, only `event: done` should mark completion.
