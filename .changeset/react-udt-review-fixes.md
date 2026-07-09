---
'@fiber-pay/sdk': patch
'@fiber-pay/react': patch
---

Address PR review feedback for React UDT components

- SDK: moved `getUdtBalance` to `@fiber-pay/sdk/browser/udt-balance` and added `parseUdtAmountFromCellData` with rigorous output_data validation.
- SDK: added `formatAssetName` and `DEFAULT_CKB_ASSET` helpers to reduce duplicated asset-label logic.
- SDK: added unit tests for `parseUdtAmountFromCellData` and `formatAssetName`.
- React: fixed `DiagnosticsTab` UDT capacity formatting so malformed capacity values no longer crash the tab.
- React: invoice creation in `FiberNodeButton` and `FiberPayQuickCard` now validates UDT scripts and sanitizes user input in descriptions via a shared `buildNewInvoiceParams` helper.
- React: `NodeInfoPanel` validates the UDT script before querying `getUdtBalance`.
- React: `ChannelsTab` now shows the specific UDT token name when available and memoizes balance formatting.
- React: replaced inline `{ kind: 'ckb' }` fallbacks with the shared `DEFAULT_CKB_ASSET` constant and stabilized `useFiberPayment` option references with `useMemo`.
- React: added `node-info-panel` UDT tests and a shared UDT script fixture.
