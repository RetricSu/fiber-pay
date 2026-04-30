---
'@fiber-pay/sdk': patch
---

feat(sdk): re-export `normalizeChannel` and `normalizeChannelStateName` from
both `@fiber-pay/sdk` and `@fiber-pay/sdk/browser`. Consumers that bypass
`listChannels` (e.g. by calling the WASM adapter or a custom transport
directly) can now use the SDK's canonical normalization helpers instead of
re-implementing the same fallback logic.
