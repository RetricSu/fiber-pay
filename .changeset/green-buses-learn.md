---
"@fiber-pay/react": patch
---

Improve React SDK developer experience with staged payment hook APIs and clearer browser integration docs.

- Add `parseInvoice`, `sendPayment`, and `waitForPayment` to `useFiberPayment` while keeping `payInvoice` compatibility.
- Document COOP/COEP requirements, expected WASM bundle impact, and retry guidance for startup failures.
- Clarify React/browser install guidance for `@nervosnetwork/fiber-js` and optional `qrcode.react`.
