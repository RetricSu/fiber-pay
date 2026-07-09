---
'@fiber-pay/sdk': minor
'@fiber-pay/react': minor
'@fiber-pay/cli': patch
---

Move UDT support down into the core `@fiber-pay/sdk` package and reuse it across the React SDK and CLI.

- `@fiber-pay/sdk` now exports UDT helpers: `UdtAsset`, `UdtTypeScript`, `parseUdtTypeScript`, `validateUdtTypeScript`, `parsePaymentAmount`, `parseFundingAmount`, `resolveUdtAsset`, and `formatChannelBalances`.
  - `resolveUdtAsset` no longer requires an RPC client when resolving by raw script.
  - `parseUdtTypeScript` and `validateUdtTypeScript` enforce a 32-byte `code_hash`, a reasonable `args` length limit, and an overall JSON length cap.
  - CKB amount parsing now tolerates trailing zeros beyond 8 decimal places (e.g. `1.000000000`).
  - `FormattedChannelBalances` is now a tagged union (`kind: 'ckb' | 'udt'`) instead of a weak `string | number` union.
- `@fiber-pay/react` hooks (`useChannelOpenFlow`, `useFiberPayment`) accept an optional UDT asset, validate the UDT script before passing it to RPC, and avoid callback identity churn via an options ref.
  - `useChannelOpenFlow` now treats an empty `fundingAmount` string as missing so it correctly falls back to the deprecated `fundingAmountCkb`.
- `@fiber-pay/cli` UDT parsing, asset resolution, and channel formatting are now delegated to the SDK instead of living in the CLI.
  - Added a unified `resolveAssetFromOptions` helper in `packages/cli/src/lib/udt.ts` to remove the repeated UDT resolution boilerplate across commands.
  - `formatChannel` now reuses the values returned by `formatChannelBalances` instead of recomputing them.
