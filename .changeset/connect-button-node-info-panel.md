---
"@fiber-pay/react": minor
---

feat(react): add ConnectButton, NodeInfoPanel components and enhance useFiberNode

- Add `<ConnectButton>` component with standalone and external-hook modes, supporting passkey/password/rawKey/auto strategies
- Add `<NodeInfoPanel>` component for displaying node stats, QR code, and copy-to-clipboard
- Add `startWithRawKey()` to `useFiberNode` hook for `RawKeyCredentialProvider` support
- Add `isStarting` and `isRunning` computed convenience booleans to `useFiberNode`
- Export `RawKeyCredentialProvider` and `scriptToAddress` from `@fiber-pay/react`
- Add `qrcode.react` as optional peer dependency for QR code rendering
