# @fiber-pay/react

## 0.2.5

### Patch Changes

- 4116af6: refactor(react): simplify `ConnectButton` strategy selection by requiring an explicit `password` or `passkey` strategy. The button no longer auto-selects credentials or exposes raw-key connection props; advanced raw-key flows remain available through `useFiberNode().startWithRawKey()`.
- a0e3c78: chore: bump Fiber default target to v0.8.1.

  - update `DEFAULT_FIBER_VERSION` to `v0.8.1` for managed binary download defaults
  - align `@nervosnetwork/fiber-js` baseline to `~0.8.1` in SDK/react-facing package dependencies
  - update dual-node e2e script default `FIBER_BINARY_VERSION` to `v0.8.1`

- 272e77c: fix(sdk): normalize channel `state.state_name` on the browser/WASM path so it
  matches the `ChannelState` enum (SCREAMING_SNAKE_CASE) returned by the RPC
  client. This fixes `FiberBrowserNode.waitForChannelReady` and any consumer that
  compares `channel.state.state_name === ChannelState.ChannelReady` on the
  browser path.

  Internal: extracted `normalizeChannel` / `normalizeChannelStateName` from
  `FiberRpcClient` into a shared `rpc/normalize-channel` module used by both the
  RPC client and the WASM adapter.

- Updated dependencies [eb4b9c3]
- Updated dependencies [a0e3c78]
- Updated dependencies [272e77c]
  - @fiber-pay/sdk@0.2.5

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
