# Agent Serve Backend Setup Guide

This guide provides a comprehensive overview of how to set up the backend environment for running `fiber-pay agent serve`. Running AI agents securely requires specific sandbox configurations (via BoxLite), network isolation, and API proxying. This document details how these mechanisms work and how to configure them for different AI agents (like OpenCode, Claude, Codex, etc.).

If you only need a from-scratch BoxLite bootstrap runbook (install CLI, create box, install acpx/opencode, smoke test), start with [boxlite-agent-setup.md](./boxlite-agent-setup.md) first.

## 0. Quick Deployment Checklist (From Scratch)

Use this checklist when installing on a new server:

1. Install and run BoxLite REST server (`boxlite serve`).
2. Create a persistent Box (`node:22-alpine`, disk >= 10 GB, strict `allowNet`) and prefer no host bind mount.
   - If a mount is unavoidable, use a dedicated least-privilege directory only (never repo root, `$HOME`, or sensitive paths).
3. Install required tools in Box:
    - `acpx@0.5.3`
    - `opencode-ai@latest`
    - `gcompat` (Alpine)
4. Verify OpenCode binary and ACP health in Box (`opencode --version`, `acpx opencode sessions ensure --name smoke`).
5. Start host Fiber node(s) for L402 issuance/payment.
6. Export provider key on host (for example `KIMI_API_KEY`) and start `fiber-pay agent serve`.
7. Validate with `fiber-pay agent call` from a payer profile.

Recommended startup command:

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
   - For filesystem safety, prefer container-local persistent disk and avoid host bind mounts unless strictly required.

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

### Proxy Host Address Selection

By default, host address is auto-detected and injected into Box proxy env.
If your runtime topology is non-standard (nested VM/container, custom bridge), auto-detection may choose an unreachable address.

Symptoms:

- payment succeeds
- request later fails with timeout / 502

Fix:

```bash
fiber-pay agent serve \
   --proxy-host-addr <HOST_IP_VISIBLE_FROM_BOX> \
   ...
```

Avoid hardcoding `10.0.2.2` unless it is confirmed reachable in your environment.

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
You can run `agent serve` with `--no-proxy` only in guarded local-debug mode. This disables both the API-key shim and the network deny-list, and the server passes host API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `GEMINI_API_KEY`) directly into the container environment.

```bash
export GEMINI_API_KEY="AIzaSy..."
export FIBER_PAY_ALLOW_INSECURE_NO_PROXY=1
fiber-pay agent serve --agent gemini --host 127.0.0.1 --no-proxy ...
```

Guardrails enforced by CLI:

- `FIBER_PAY_ALLOW_INSECURE_NO_PROXY=1` must be present
- `--host` must be loopback (`127.0.0.1`, `localhost`, or `::1`)

> **WARNING**: Even with these guardrails, no-proxy mode is unsafe for production. Use proxy mode by default.

## 5. Session Management & Cleanup

To ensure state consistency, `agent serve` manages deterministic, isolated session workspaces:
- Named sessions use persistent paths: `/workspace/sessions/<sessionId>`.
- Anonymous sessions use random UUID paths and are automatically deleted after the request completes.

**Disk Pressure & Auto-cleanup:**
The server routinely checks the container's `/workspace` disk space.
- You can configure the `workspaceTtl` (default: 24 hours).
- If disk usage exceeds 90%, the service automatically drops the TTL to 1 hour and accelerates the cleanup interval.
- If disk usage exceeds 95%, the service will crash proactively to prevent corruption. Use `--workspace-min-free-mb` to enforce a buffer.

### Session-scoped static workspace serving

`agent serve` now supports a simple static endpoint for session workspace files:

```http
GET /workspace/static/<path>
```

Auth:

- `x-session-id: <sessionId>` header.
- `x-session-token: <token>` header.

Security behavior:

- Token must verify and match `x-session-id`.
- File access is constrained to `/workspace/sessions/<sessionId>/`.
- Path traversal and path escape are rejected.
- Directory path requests fallback to `index.html`.

Directory listing endpoint:

```http
GET /workspace/static/list?path=<relative-directory>
```

Response includes `entries` (`file` / `dir` / `symlink`), current relative path,
and whether the result was truncated by server-side limit.

Token validity uses the same session token TTL rule as chat session resume.
By default (no `--workspace-ttl` override), effective token window is 24 hours.

## 6. Real-World Pitfalls And Fixes

### A. Warning: No provider API keys found for proxy injection

Meaning:

- service did not find supported key envs on host at startup (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `KIMI_API_KEY`, or fallback `OPENCODE_API_KEY`)

Behavior:

- service still starts
- existing in-Box OpenCode config is preserved
- proxy key-shim is not configured for missing providers

Action:

- export the expected provider key before startup (for Kimi: `KIMI_API_KEY`)

### B. opencode initializes but first request is slow or times out

Cause:

- cold install/cache of provider adapters and daemon startup

Action:

- keep startup prewarm enabled
- restart service if Box had stale `opencode`/`acpx` processes

### C. Session ensure/new mismatch leads to request failure

Cause:

- session bootstrap can fail in one step and needs fallback path

Action:

- use isolated `sessions ensure`, then fallback to `sessions new` and surface both stderr snippets for debugging

### D. Response appears truncated in client UI

Two different classes of issues can look similar:

1. Transport accumulation issue
   - stream may flush stdout frames after an `exit` frame
   - runtime should consume full response body before finalizing
2. UI parser issue
   - model text may contain markers like `[thinking]` and `[done] end_turn`
   - frontend must not treat inline marker text as protocol EOF
   - in SSE mode, only `event: done` indicates completion

### E. Should NO_PROXY be considered a hard security boundary?

No. In-process code can override env vars like `NO_PROXY` for its own outbound requests.

Use defense in depth:

1. Keep proxy mode enabled (default).
2. Do not place raw provider keys in Box environment.
3. Restrict BoxLite `allowNet` to minimal required domains.
4. Keep host services (Fiber RPC, internal APIs) out of reachable network scope.

### F. Is `KIMI_BASE_URL=http://<HOST_IP>:<PROXY_PORT>/kimi` visible in Box a risk?

Short answer: visibility of the base URL itself is expected and not a secret.

Risk comes from capability, not from URL disclosure:

- code in the Box can call that endpoint
- if proxy is overly exposed, unauthorized callers may abuse your key-shim
- prompt-injected workloads can still consume quota through the proxy

Mitigations:

1. Keep proxy mode enabled and keep no-proxy blocked in production.
2. Keep Box `allowNet` as proxy-only (`<PROXY_HOST_ADDR>`), plus temporary `registry.npmjs.org` only when needed.
3. Restrict proxy listener reachability with host firewall/security group (Box subnet only).
4. Add request auth between Box and proxy (for example static bearer token or mTLS) if you deploy across hosts.
5. Enforce rate limits and request timeouts at proxy.

### G. Risks of proxy listening on `0.0.0.0:3000` and how to defend

Main risks:

- anyone who can reach the port can attempt to use your proxy endpoints
- potential key-shim abuse and external API cost burn
- open forward-proxy behavior can be abused for scanning/SSRF if controls are weak
- DoS risk from connection floods

Recommended hardening:

1. Prefer binding proxy to loopback or a dedicated private interface, not public `0.0.0.0`.
2. If `0.0.0.0` is required, enforce network ACL/firewall allow-list to Box nodes only.
3. Require authentication for proxy requests.
4. Keep CONNECT restrictions strict (deny private/loopback/link-local/metadata ranges).
5. Add connection limits, body-size limits, and per-IP rate limiting.
6. Log and alert on abnormal proxy usage (burst traffic, unknown destinations, repeated 407/403 patterns).
