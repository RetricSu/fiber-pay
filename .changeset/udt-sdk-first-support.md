---
'@fiber-pay/sdk': minor
'@fiber-pay/react': minor
'@fiber-pay/cli': patch
---

Move UDT support down into the core `@fiber-pay/sdk` package and reuse it across the React SDK and CLI.

- `@fiber-pay/sdk` now exports UDT helpers: `UdtAsset`, `UdtTypeScript`, `parseUdtTypeScript`, `parsePaymentAmount`, `parseFundingAmount`, `resolveUdtAsset`, and `formatChannelBalances`.
- `@fiber-pay/react` hooks (`useChannelOpenFlow`, `useFiberPayment`) accept an optional UDT asset and pass it through to the SDK.
- `@fiber-pay/cli` UDT parsing, asset resolution, and channel formatting are now delegated to the SDK instead of living in the CLI.
