---
"@fiber-pay/sdk": minor
---

Relax browser passkey policy to allow non-platform authenticators (including Linux setups) while still requiring secure context, WebAuthn support, and PRF capability.

Also remove forced `authenticatorSelection.authenticatorAttachment = "platform"` during passkey registration.
