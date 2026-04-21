# L402 & Agent Service

fiber-pay supports L402 payment-gated APIs and paid AI agent services.

## SDK: L402 Module

`@fiber-pay/sdk/node` exports L402 primitives:

- `MacaroonService` — mint/verify L402 tokens with configurable caveats
- `createL402Middleware(config)` — Express middleware for 402 challenge-response
- `DefaultResourceResolverRegistry` — route-based resource resolver

Key config for `createL402Middleware`:

```ts
{
  rootKey: string,        // 32-byte hex (or L402_ROOT_KEY env)
  priceCkb: number,       // price per request
  expirySeconds: number,  // token validity
  rpcClient: FiberRpcClient,
  currency: 'Fibt' | 'Fibb',
}
```

## CLI: l402 proxy

Reverse proxy with L402 payment gate. Forwards paid requests to `--target`.

```bash
fiber-pay l402 proxy --target http://localhost:3000 --price 0.1 --root-key <hex>
```

Key flags: `--port` (default 8402), `--host`, `--expiry`, `--json`.

## CLI: agent serve

HTTP service that invokes a local AI agent via [acpx](https://github.com/openclaw/acpx), gated behind L402 payment.

```bash
fiber-pay agent serve --agent opencode --price 0.1 --root-key <hex> --approve-all
```

- Endpoint: `POST /` with `{"prompt": "...", "sessionId": "<optional>"}`
- Requires: `npm install -g acpx` and the target agent installed
- Agents: any acpx-compatible — `codex`, `claude`, `opencode`, `gemini`, `pi`, etc.
- Session mode: pass `sessionId` to maintain multi-turn context across requests

Key flags: `--port`, `--cwd`, `--timeout`, `--approve-all`, `--format`, `--no-isolation`.

### Per-session Linux namespace isolation

Each paid session runs in an isolated Linux namespace so that opencode/codex/claude
**cannot access other users' files or processes**:

| Isolation layer | Mechanism | Effect |
|----------------|-----------|--------|
| File system | `mount --bind` per session | Agent sees `/workspace` = its own private dir only |
| Process visibility | PID namespace | `ps`, `/proc` shows only the session's own processes |
| Temp directory | `mount --bind /tmp` | `/tmp` is private to the session |
| Privilege | user namespace (`--map-root-user`) | Virtual root inside namespace, no real escalation |

Session workspace layout inside the BoxLite box:

```
/workspace/sessions/<sanitized-sessionId>/   ← bind-mounted as /workspace
/tmp/fiber-sessions/<sanitized-sessionId>/   ← bind-mounted as /tmp
```

Isolation is **automatic** — the server probes `unshare` capability at startup and
prints the active mode:

```
Isolation:  namespace (PID + mount + user)   ← full isolation
Isolation:  directory-only (unshare unavailable)  ← fallback
Isolation:  disabled (--no-isolation)         ← debug flag used
```

#### BoxLite container setup (Alpine Linux)

Run `scripts/boxlite-setup.sh` once inside the BoxLite box to install `util-linux`
(provides the full-featured `unshare`) and pre-create the session directories:

```bash
# Execute via BoxLite exec API or directly inside the container
sh scripts/boxlite-setup.sh
```

The script also probes whether the host kernel allows unprivileged user namespaces.
If the probe fails, check on the host:

```bash
sysctl kernel.unprivileged_userns_clone   # must be 1
# Set permanently:
echo 'kernel.unprivileged_userns_clone = 1' >> /etc/sysctl.conf && sysctl -p
```

#### Disabling isolation (debug only)

```bash
fiber-pay agent serve --agent opencode --price 0.1 --root-key <hex> --no-isolation
```

`--no-isolation` skips both the `unshare` probe and the namespace wrapping. All
sessions share the same `/workspace` — suitable only for local development.

## CLI: agent call

Call a remote `agent serve` with automatic L402 payment via Fiber.

```bash
fiber-pay agent call http://host:8402 --prompt "explain the code"
```

Flow: send prompt → receive 402 → pay invoice → retry with token → return response.

Prompt sources: `--prompt <text>`, `--file <path>`, or piped stdin.

## Multi-node example

```bash
# Node A: serve (with isolation)
fiber-pay agent serve --agent opencode --price 0.1 --root-key $(openssl rand -hex 32)

# Node B: call and pay
fiber-pay --profile user agent call http://127.0.0.1:8402 --prompt "say hello"
```

## Security model summary

| Threat | `noIsolation` (off) | With namespace isolation |
|--------|---------------------|--------------------------|
| Agent reads another session's `/workspace` | ✅ possible | ❌ path not visible in mount namespace |
| Agent sees other sessions' processes | ✅ via `ps` | ❌ PID namespace hides them |
| Agent pollutes shared `/tmp` | ✅ possible | ❌ private `/tmp` per session |
| Deliberate path traversal by known abs path | ✅ possible | ⚠️ same UID; use UUID session IDs |

Session IDs are sanitized and session dirs are named with the sanitized ID.
For additional hardening, use random UUID values as session IDs from the client side.
