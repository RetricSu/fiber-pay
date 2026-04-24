# @fiber-pay/react

## 0.2.4

### Patch Changes

- d8f763b: feat(react): add ConnectButton, NodeInfoPanel components and enhance useFiberNode

  - Add `<ConnectButton>` component with standalone and external-hook modes, supporting passkey/password/rawKey/auto strategies
  - Add `renderConnectedDropdown` and `dropdownStyle` to `<ConnectButton>` so apps can inject project-specific connected menus while reusing SDK lifecycle logic
  - Add `<NodeInfoPanel>` component for displaying node stats, QR code, and copy-to-clipboard
  - Add `startWithRawKey()` to `useFiberNode` hook for `RawKeyCredentialProvider` support
  - Add `isStarting` and `isRunning` computed convenience booleans to `useFiberNode`
  - Export `RawKeyCredentialProvider` and `scriptToAddress` from `@fiber-pay/react`
  - Add `qrcode.react` as optional peer dependency for QR code rendering

- 713aa2d: feat(sdk,react): re-export common browser types and utilities
- Updated dependencies [b049830]
- Updated dependencies [0f6ead3]
- Updated dependencies [713aa2d]
  - @fiber-pay/sdk@0.2.4

## 0.2.3

### Patch Changes

- 000909c: Add a new React package with one-line imports for browser wallet integrations.

  Included in this release:

  - `useFiberNode` hook for passkey/password startup and node lifecycle
  - `useFiberPayment` hook for invoice payment flow
  - `FiberPayQuickCard` starter component for fast integration
  - browser-wallet dogfooding integration using `@fiber-pay/react`
  - @fiber-pay/sdk@0.2.3
