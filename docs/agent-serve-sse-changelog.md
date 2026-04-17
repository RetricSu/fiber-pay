# Agent Serve SSE Changelog (Frontend)

Date: 2026-04-17  
Scope: `fiber-pay agent serve` HTTP `POST /`

## Summary

`agent serve` now supports SSE streaming for prompt execution output.

- Old behavior (default): blocking JSON response after full command completion.
- New behavior (opt-in): stream incremental output via `text/event-stream`.

This update is designed to prevent long-running requests from appearing as "no response" on unstable networks.

## Compatibility

This is a backward-compatible rollout.

- Existing clients continue to work with JSON mode.
- Frontend can opt in to SSE mode per request.

## How To Enable SSE

Send either:

1. Request body field: `stream: "sse"` (recommended)
2. Header: `Accept: text/event-stream`

Example request body:

```json
{
  "prompt": "Explain this repo",
  "sessionId": "my-session-123",
  "format": "json",
  "stream": "sse"
}
```

## Response Protocol In SSE Mode

HTTP headers:

- `Content-Type: text/event-stream; charset=utf-8`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`

Event types:

1. `event: chunk`
2. `event: done`
3. `event: error`

### `chunk`

```text
event: chunk
data: {"type":"stdout","text":"partial output..."}
```

```text
event: chunk
data: {"type":"stderr","text":"warning or error line..."}
```

Fields:

- `type`: `stdout` | `stderr`
- `text`: incremental text segment

### `done`

```text
event: done
data: {"durationMs":283864,"agent":"codex","format":"json"}
```

Fields:

- `durationMs`: server-side execution duration
- `agent`: agent name
- `format`: present when request format is not `quiet`

### `error`

```text
event: error
data: {"code":"EXEC_FAILED","message":"BoxLite exec timed out","agent":"codex","durationMs":120000}
```

Fields:

- `code`: error code, e.g. `EXEC_FAILED`, `BOXLITE_UNREACHABLE`, `INTERNAL_ERROR`
- `message`: human-readable message
- `agent`: agent name
- `durationMs`: elapsed time until error

## Important Frontend Semantics

1. SSE-mode logical failures are delivered as `event: error`, not as non-2xx HTTP status.
2. End-of-stream success is defined by receiving `event: done`.
3. You should merge all `chunk` events in order to build final transcript/output.
4. Keep your UI resilient to partial output and abrupt disconnect.

## Minimal Frontend Migration Steps

1. Add `stream: "sse"` to the `POST /` request body.
2. Read the response as an SSE stream (fetch + readable stream parser).
3. Append `chunk` payload to UI in real time.
4. Mark task complete only on `done`.
5. Surface errors from `error` event payload.

## Fetch-Based SSE Reader Example

```ts
async function callAgentSse(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: 'sse' }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Request failed: ${res.status}`);
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const eventMatch = frame.match(/^event:\s*(.+)$/m);
      const dataMatch = frame.match(/^data:\s*(.+)$/m);
      if (!eventMatch || !dataMatch) continue;

      const event = eventMatch[1];
      const data = JSON.parse(dataMatch[1]);

      if (event === 'chunk') {
        // append chunk text to UI
      } else if (event === 'done') {
        // mark complete
      } else if (event === 'error') {
        // surface error
      }
    }
  }
}
```

## JSON Mode (No Change)

When SSE is not requested, response remains:

```json
{
  "response": "...",
  "agent": "codex",
  "durationMs": 1234,
  "format": "json",
  "data": []
}
```

## QA Checklist For Frontend

- Long task (>5 min) still receives periodic chunks or keepalive and does not hang.
- `done` always transitions UI to completed state.
- `error` shows correct message and stops loading state.
- Session mode (`sessionId`) still works in SSE path.
- JSON mode fallback path still works when stream is disabled.
