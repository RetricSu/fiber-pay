---
"@fiber-pay/cli": patch
"@fiber-pay/runtime": patch
---

Fix synchronous file I/O blocking in FNN log handling

- Replace `appendFileSync` with async `WriteStream`-based `LogWriter` class
- Add `flushPendingLogs()` for graceful shutdown coordination
- Convert runtime alert file backends to async I/O
- Improves performance under high-volume log output
- Prevents event loop blocking that could stall FNN process

Fixes #73
