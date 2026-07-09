---
'@fiber-pay/sdk': minor
'@fiber-pay/react': minor
---

Add UDT support to high-level React SDK components

- `ConnectButton` now accepts an optional `asset` prop and exposes it to custom dropdown renderers.
- `FiberNodeButton` and its panel accept `asset`, `initialFundingAmount`, and `invoiceAmount` props. Channel open, invoice creation, and payment flows now respect the selected asset.
- `FiberNodeButton` channel lists and details display CKB or UDT balances using `formatChannelBalances`.
- `FiberPayQuickCard` accepts `asset` and `invoiceAmount` and uses them when creating invoices and sending payments.
- `NodeInfoPanel` accepts `asset` and displays the corresponding balance (CKB or UDT).
- Added `getUdtBalance` to `@fiber-pay/sdk/browser` for querying UDT balances by lock script and type script.
