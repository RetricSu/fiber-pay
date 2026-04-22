# Agent Serve Frontend Integration Guide

This guide is for external frontend or application projects that call `fiber-pay agent serve` directly.

It focuses on:

- session contract changes (`sessionId` + `sessionToken`)
- migration steps from older clients
- security requirements for bearer-style session tokens
- practical request and error handling patterns

For core CLI usage and L402 background, also read [l402-agent-guide.md](./l402-agent-guide.md).

## Who should read this

- Browser frontend apps
- Mobile apps
- Server-side app backends that proxy user prompts to `agent serve`

## Breaking contract change

Session ownership is now enforced with a server-signed token.

Old behavior:

- clients could reuse context by sending only `sessionId`

New behavior:

- new session request: send only `prompt`
- resume session request: send `prompt`, `sessionId`, and `sessionToken`
- sending only one of `sessionId` or `sessionToken` is rejected

## Request and response contract

### 1) Start a new session

Request:

```http
POST /
Content-Type: application/json

{
  "prompt": "Explain channel rebalance in simple terms"
}
```

Success response shape:

```json
{
  "response": "...",
  "agent": "codex",
  "durationMs": 1234,
  "session": {
    "id": "sess-...",
    "token": "fpst....",
    "created": true
  }
}
```

Client action:

- persist `session.id` and `session.token` together

### 2) Resume an existing session

Request:

```http
POST /
Content-Type: application/json

{
  "prompt": "Continue from previous answer and add examples",
  "sessionId": "sess-...",
  "sessionToken": "fpst...."
}
```

Typical response:

```json
{
  "response": "...",
  "agent": "codex",
  "durationMs": 1180,
  "session": {
    "id": "sess-...",
    "token": "fpst....",
    "created": false
  }
}
```

### 3) SSE mode

When using SSE, `done` and `error` events include `session` as well.

This lets streaming clients keep session state in sync.

## Error codes you must handle

Session contract failures:

- `400 SESSION_MISSING_TOKEN`
- `400 SESSION_INVALID_INPUT`
- `400 SESSION_INVALID_ID`
- `403 SESSION_INVALID_TOKEN`

Operational failures (existing behavior):

- `502 EXEC_FAILED` style agent execution failure payloads
- standard `402` challenge when L402 payment is required

## End-to-end integration flow (L402 + session)

1. Send prompt request to `POST /`.
2. If response is `402`, parse macaroon and invoice.
3. Pay invoice through your Fiber node.
4. Retry request with L402 headers.
5. Read `session.id` and `session.token` from success response.
6. On next turn, send both `sessionId` and `sessionToken`.

## Frontend migration checklist

1. Remove client-side session ID generation for new sessions.
2. Add `sessionToken` field to your local chat/session model.
3. Update resume calls to send both fields.
4. Add explicit handling for `SESSION_*` error codes.
5. Ensure SSE parser captures `session` from `done` and `error` events.
6. Add regression tests for:
   - new-session flow (prompt only)
   - resume flow (id + token)
   - missing token (400)
   - tampered token (403)

## Security notes for session tokens

`sessionToken` is a bearer credential.

If leaked, an attacker can replay session ownership during token validity.

They still need to satisfy L402 payment checks, but session ownership can be hijacked for that window.

Minimum controls:

1. HTTPS only (no plaintext transport).
2. Never log `sessionToken` (app logs, analytics, error telemetry).
3. Prefer in-memory storage for active chat sessions.
4. If persistence is required, use shortest practical lifetime and protect at rest.
5. Delete local session state when the user ends a conversation.

Recommended hardening:

1. Keep token lifetime short (hours, not days).
2. Rotate/refresh tokens on long sessions.
3. Add anomaly monitoring for repeated `SESSION_INVALID_TOKEN` responses.
4. Avoid exposing full request/response payloads in debugging tools.

## Compatibility note

Clients that only send `sessionId` on resume are no longer compatible.

Update to the new contract before rolling out server versions with signed session enforcement.

## Related docs

- [l402-agent-guide.md](./l402-agent-guide.md)
- [boxlite-agent-setup.md](./boxlite-agent-setup.md)
- [agent-serve-sse-changelog.md](./agent-serve-sse-changelog.md)
