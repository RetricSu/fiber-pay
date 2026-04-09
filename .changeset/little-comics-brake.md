---
"@fiber-pay/sdk": patch
---

# @fiber-pay/sdk

Refine SDK entrypoint boundaries for better browser safety and developer experience.

- Add `@fiber-pay/sdk/node` subpath export for Node-focused APIs
- Move L402 server exports (`createL402Middleware`, `MacaroonService`, etc.) out of root entry
- Keep root entry (`@fiber-pay/sdk`) focused on universal/browser-safe APIs
- Update docs and internal usage examples to import L402 APIs from `@fiber-pay/sdk/node`
