# Agent Serve Backend Setup Guide

This guide provides a comprehensive overview of how to set up the backend environment for running `fiber-pay agent serve`. Running AI agents securely requires specific sandbox configurations (via BoxLite), network isolation, and API proxying. This document details how these mechanisms work and how to configure them for different AI agents (like OpenCode, Claude, Codex, etc.).

## 1. Architecture Overview

When you run `fiber-pay agent serve`, the process involves several layers of isolation and security:

1. **Host Process (`fiber-pay agent serve`)**:
   - Manages the L402 payment gate via Fiber node RPC.
   - Starts a local Host-side Proxy (by default on port 8111) to intercept and filter outbound traffic from the container.
   - Holds the real API keys (e.g., `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `KIMI_API_KEY`).

2. **BoxLite VM / Sandbox**:
   - Executes the actual AI agent via `acpx`.
   - Never sees the real API keys (receives `fp-shim-placeholder` instead).
   - All network traffic is forced through the Host-side Proxy via `HTTP_PROXY` and `HTTPS_PROXY`.

3. **Per-Session Linux Namespaces**:
   - Every request is wrapped in a Linux namespace using `unshare`.
   - Each session gets a completely private, isolated view of `/workspace` and `/tmp`.
   - The agent cannot enumerate other sessions' processes (private PID namespace).

## 2. BoxLite Container Requirements

To support the isolation requirements, your BoxLite container must have the appropriate kernel features and utilities. 

### Namespace Isolation (`unshare`)
The container relies on the `unshare` utility provided by `util-linux` to isolate requests. Alpine Linux's built-in BusyBox `unshare` lacks necessary flags, so `util-linux` is strictly required.

To prepare the container, run the provided setup script inside the Box:
```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- sh scripts/boxlite-setup.sh
```

This script will:
1. Install `util-linux`.
2. Create the required base directories (`/workspace/sessions`, `/tmp/fiber-sessions`).
3. Probe the kernel to ensure unprivileged user namespaces are enabled.

> **Note**: If the isolation probe fails, ensure the host machine has unprivileged user namespaces enabled: `sysctl -w kernel.unprivileged_userns_clone=1`.

## 3. The Host-Side Proxy

By default, `agent serve` enables a host-side proxy (`--proxy`) that provides two critical security layers:

### API-Key Shim (Reverse Proxy)
The container is injected with fake placeholder keys (`fp-shim-placeholder`). The agent directs its API requests to the proxy via injected `*_BASE_URL` variables. The proxy intercepts these requests, strips the fake headers, injects the real API keys from the host's environment, and securely forwards the requests to the upstream providers (e.g., Anthropic, OpenAI, Kimi) over HTTPS.

### Network Deny-List (Forward Proxy)
The proxy acts as an explicit HTTP/HTTPS tunnel (`HTTP_PROXY`, `HTTPS_PROXY`). Any `CONNECT` requests from the container are resolved on the host. The proxy enforces a strict CIDR deny-list to block requests to:
- Loopback (`127.0.0.0/8`, `::1/128`)
- RFC-1918 Private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- Link-local and other restricted spaces.

This prevents the sandboxed agent from scanning or attacking internal services on your local network.

## 4. Configuring Specific Agents

Depending on the agent you are serving, the environment injection behaves slightly differently.

### OpenCode (`opencode`)
OpenCode requires configuration via a `opencode.json` file rather than standard environment variables for its `baseURL`.

When the proxy is enabled, `agent serve` automatically generates and injects the required proxy configuration directly into the container at `/home/boxlite/.config/opencode/opencode.json`. It configures the `baseURL` for supported providers (Anthropic, OpenAI, Kimi Code) to point back to the host proxy.

**To run OpenCode:**
```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export KIMI_API_KEY="sk-kimi-..."
fiber-pay agent serve --agent opencode ...
```
No manual config mapping is required as long as the proxy is enabled.

### Claude (`claude`), Codex (`codex`), and Kimi
These agents respect standard base URL environment variables. The proxy automatically sets the following variables inside the container:
- `OPENAI_API_KEY="fp-shim-placeholder"`
- `OPENAI_BASE_URL="http://<HOST_IP>:<PROXY_PORT>/openai"`
- `ANTHROPIC_API_KEY="fp-shim-placeholder"`
- `ANTHROPIC_BASE_URL="http://<HOST_IP>:<PROXY_PORT>/anthropic"`
- `KIMI_API_KEY="fp-shim-placeholder"`
- `KIMI_BASE_URL="http://<HOST_IP>:<PROXY_PORT>/kimi"`
- `HTTP_PROXY` and `HTTPS_PROXY`

**To run with these providers:**
```bash
export OPENAI_API_KEY="sk-..."       # For Codex
export ANTHROPIC_API_KEY="sk-ant-..." # For Claude
export KIMI_API_KEY="sk-kimi-..."    # For Kimi
fiber-pay agent serve --agent codex ...
```

### Other Agents (Gemini, Pi, etc.)
Currently, the proxy's API-key shim only supports reverse proxying for OpenAI, Anthropic, and Kimi Code. For agents utilizing Gemini or other providers, the proxy cannot inject the keys dynamically. 

If you are using an agent that requires other API keys, you have two options:

**Option A (Recommended): Store keys in the BoxLite Container**
Keep the proxy enabled for network isolation, but manually configure the API keys inside the Box:
```bash
boxlite --url http://localhost:8100 exec fiber-pay-agent -- sh -c 'echo "export GEMINI_API_KEY=your-key" >> /etc/profile'
```

**Option B (Insecure): Disable the Proxy**
You can run `agent serve` with `--no-proxy`. This disables both the API-key shim and the network deny-list. The server will pass the host's raw API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `GEMINI_API_KEY`) directly into the container's environment.

```bash
export GEMINI_API_KEY="AIzaSy..."
fiber-pay agent serve --agent gemini --no-proxy ...
```
> **WARNING**: Disabling the proxy allows the container to make unrestricted network requests to your local network and exposes your raw API keys within the container's environment.

## 5. Session Management & Cleanup

To ensure state consistency, `agent serve` manages deterministic, isolated session workspaces:
- Named sessions use persistent paths: `/workspace/sessions/<sessionId>`.
- Anonymous sessions use random UUID paths and are automatically deleted after the request completes.

**Disk Pressure & Auto-cleanup:**
The server routinely checks the container's `/workspace` disk space.
- You can configure the `workspaceTtl` (default: 24 hours).
- If disk usage exceeds 90%, the service automatically drops the TTL to 1 hour and accelerates the cleanup interval.
- If disk usage exceeds 95%, the service will crash proactively to prevent corruption. Use `--workspace-min-free-mb` to enforce a buffer.
