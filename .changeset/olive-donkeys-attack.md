---
"@fiber-pay/sdk": minor
"@fiber-pay/react": minor
"@fiber-pay/node": minor
"@fiber-pay/cli": minor
---

Upgrade the Fiber target to fnn v0.9.0 stable. Bumps `@nervosnetwork/fiber-js` to `~0.9.0`, adds the new `Stale` channel state (classified as pending in React components), the optional `payment_preimage` field on `PaymentInfo`, and the Admin-module `backup()` RPC method (RPC-client-only; not on the shared `IFiberClient` interface). New nodes and `fiber-pay node upgrade` now default to fnn v0.9.0.

Safety follow-ups for the new surface: the React panel never routes `Stale` channels to `abandon_channel` (they are funded and awaiting the post-restore passive audit), runtime payment alert payloads are field-whitelisted so `payment_preimage` is never emitted to alert backends, and CLI messages render the target version from `DEFAULT_FIBER_VERSION` instead of hardcoded strings.
