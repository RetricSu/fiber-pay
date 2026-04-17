# Agent Serve SSE Streaming Design

## Problem

Long-running agent prompts (e.g., `git clone` + `npm build` + test via opencode) frequently fail from the frontend perspective because the HTTP connection is silently dropped after 4–5 minutes of inactivity.

The current `agent serve` implementation waits for the **entire** `acpx` process to finish before sending any response bytes:

```
frontend ──POST /──► agent-serve ──► BoxLite ──► acpx opencode -s <session> <prompt>
                                                     ↓ (4–5 min of silence)
frontend ◄──JSON─── agent-serve ◄── BoxLite ◄── process exits
```

While `opencode` itself often generates an answer in a few seconds, the `acpx` wrapper with session recovery / queue-owner overhead can take **280–300 seconds** before it returns an exit code. During this time:

- No bytes flow back to the browser.
- NAT routers, proxies, or mobile networks silently drop the TCP connection.
- The frontend shows "no response" even though the server eventually completes the work.

## Root Cause

- `acpx` (the CLI) **does not support SSE or chunked streaming**. Its `--format` options are `text | json | quiet`, all of which buffer output until process exit.
- However, `BoxliteClient.exec()` internally **polls** `/executions/{id}/output` every 500 ms and receives **incremental stdout chunks** via SSE-like events from BoxLite.
- `agent-serve.ts` discards these incremental chunks, accumulating them in memory and only flushing the full response when `acpx` exits.

## Proposed Solution

Convert `POST /` in `agent-serve.ts` from a blocking JSON endpoint to an **SSE endpoint** that forwards BoxLite execution chunks to the frontend in real time.

```
frontend ──POST /──► agent-serve ──► BoxLite exec start ──► acpx opencode ...
       ▲                              │
       │         SSE chunks ◄─────────┘
       │         (every poll cycle)
       │
   EventSource
```

### Architecture

1. **Client initiates prompt**
   - Frontend sends `POST /` with `prompt`, `sessionId`, `format`, etc.
   - Server immediately returns `Content-Type: text/event-stream`.

2. **Server starts BoxLite execution**
   - Instead of calling `runAcpx()` (which blocks), `agent-serve` will:
     - Ensure session if needed.
     - Call `BoxliteClient.exec()` but **not block**; rather, expose the polling loop so every new chunk can be pushed downstream.
   - Each time the poller gets new stdout/stderr from BoxLite, it is base64-decoded and emitted as an SSE `data:` frame.

3. **Termination events**
   - When the process exits with `exit_code === 0`, emit a final `event: done` frame with optional metadata (`durationMs`, `format`).
   - When the process exits non-zero or times out, emit `event: error` with details, then close the stream.

4. **Cleanup remains unchanged**
   - On timeout or abort, `cancelExecution()` is invoked.
   - On any exception path, `sessions close` is attempted before emitting `event: error`.

### Event Schema (draft)

```text
event: chunk
data: {"type":"stdout","text":"Cloning into 'offckb'...\n"}

event: chunk
data: {"type":"stderr","text":"npm error ..."}

event: done
data: {"durationMs":283864,"format":"json"}

event: error
data: {"code":"EXEC_FAILED","message":"BoxLite exec timed out"}
```

### Frontend Changes

- Replace `fetch()` with `new EventSource(url)` or a fetch-based SSE reader.
- Append each `chunk` to the UI immediately.
- On `done`, mark the conversation turn as complete.
- On `error`, show the error message.
- If the EventSource connection drops unexpectedly, show a "Connection lost" state (the server will still cancel/close via the new cleanup logic).

### Why This Works Despite acpx Not Streaming

The key insight is that **BoxLite’s exec API already streams** execution output incrementally. `agent-serve` is currently the bottleneck because it buffers everything. By forwarding BoxLite’s poll results as SSE frames, we restore liveness to the TCP connection without requiring any changes to `acpx` or `opencode`.

## Implementation Notes

### Files to Modify

- `packages/cli/src/lib/agent-serve.ts`
  - Refactor `POST /` handler to set SSE headers.
  - Extract the BoxLite polling loop from `BoxliteClient.exec()` into a generator or callback-based helper inside `agent-serve.ts` (or add a streaming variant to `BoxliteClient`).
  - Ensure `res.write()` is flushed after each chunk.
- `packages/cli/src/lib/boxlite-client.ts`
  - Add `execStream(command, args, options)` that yields `{ stdout, stderr, exit_code? }` on each poll iteration.
  - Keep `exec()` as the existing blocking API for backward compatibility.

### Express SSE Boilerplate

```typescript
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');

function sendEvent(event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
```

### Edge Cases

| Scenario | Handling |
|----------|----------|
| **Client disconnects mid-stream** | `req.on('close', ...)` triggers `cancelExecution()` and `sessions close`. |
| **BoxLite timeout** | Emit `event: error` after calling `cancelExecution()`. |
| **Non-zero exit code** | Emit final stderr as `chunk`, then `event: error`. |
| **Empty stdout** | Stream may consist only of `event: done`. This is fine because headers are sent immediately. |
| **JSON format** | Each line of JSON output is emitted as its own `chunk`; frontend can parse lines individually. |

## Alternatives Considered

1. **Keepalive JSON hack** — Write whitespace chunks every 30 s while waiting for `runAcpx()` to finish, then send the real JSON. Rejected because it breaks `Content-Type: application/json` expectations and is fragile across proxies.
2. **Async job + polling** — `POST /` returns `jobId`, frontend polls `GET /jobs/:jobId`. Rejected because it requires larger frontend changes and still leaves the user waiting without incremental feedback.
3. **Use native acpx streaming** — Not possible; acpx does not expose a streaming CLI flag.

## Decision

**Proceed with SSE streaming in `agent-serve.ts`, consuming incremental BoxLite poll output.**

This is the minimal-change solution that:
- Keeps the TCP connection alive for long tasks.
- Does not require changes to `acpx`, `opencode`, or BoxLite runtime.
- Provides a good UX foundation for future real-time agent UIs.
