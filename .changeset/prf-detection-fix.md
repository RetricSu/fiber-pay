---
"@fiber-pay/sdk": patch
"browser-wallet": patch
---

fix: improve PRF detection for Chrome on Linux

- Remove fallback detection that triggered unwanted passkey UI
- When getClientCapabilities() returns prf: undefined (Chrome on Linux),
  return 'unknown' status instead of attempting detection
- Update UI to show passkey option when capability is 'unknown',
  allowing users to try passkey on platforms with incomplete capability reporting