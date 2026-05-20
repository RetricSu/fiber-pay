---
"@fiber-pay/sdk": patch
"@fiber-pay/react": patch
---

Add external funding channel RPC support in the SDK, including typed client methods for:
- `open_channel_with_external_funding`
- `submit_signed_funding_tx`

Add optional external wallet mode for React integrations:
- `useFiberNode({ externalWallet?: boolean })`
- `ConnectButton` supports optional `strategy` (default `passkey`) and `externalWallet`

Update the `react-quick-card` example to demonstrate passkey/password strategies with optional external wallet mode.
