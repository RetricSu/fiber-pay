# @fiber-pay/react

## 0.2.7

### Patch Changes

- ec536f4: Upgrade default Fiber target to fnn v0.9.0-rc4

  - Remove support for the standalone `fnn-migrate` binary shipped with new fnn releases.
  - Add a legacy migration path that uses the v0.8.1 `fnn-migrate` to bring old stores up to the v0.9.0 epoch.
  - `node start` now auto-confirms fnn's built-in migration prompt.
  - SDK gains `listPayments` and node config gains v0.9.0-rc4 optional fields.
  - `fiber-pay node upgrade` now targets the bundled default Fiber version (`v0.9.0-rc4`) when `--version` is omitted, instead of resolving the GitHub latest release.
  - Remove the dangling `--force-migrate` option from `fiber-pay node upgrade`.

- Updated dependencies [ec536f4]
  - @fiber-pay/sdk@0.2.7

## 0.2.6

### Patch Changes

- db233e8: Update the `react-fiber-node-button-lab` example so the custom CCC wallet connector section is only rendered when external funding mode is enabled.

  This aligns the demo UI with the actual channel-open funding flow and avoids showing external wallet controls while internal funding mode is active.

- 7bc83aa: Add external funding channel RPC support in the SDK, including typed client methods for:

  - `open_channel_with_external_funding`
  - `submit_signed_funding_tx`

  Add optional external wallet mode for React integrations:

  - `useFiberNode({ externalWallet?: boolean })`
  - `ConnectButton` supports optional `strategy` (default `passkey`) and `externalWallet`

  Update the `react-quick-card` example to demonstrate passkey/password strategies with optional external wallet mode.

- b0610f7: Restructure official demos into an examples-based coverage matrix and refresh integration docs.

  New layer-oriented examples:

  - react-min-connect (useFiberNode + ConnectButton minimal integration)
  - react-fiber-node-button-lab (FiberNodeButton default/custom tabs workflow)
  - browser-sdk-playground (direct @fiber-pay/sdk/browser usage)
  - sdk-node-recipes (FiberRpcClient Node script recipes)

  This release improves discoverability and onboarding paths for React and SDK integrations.

- 9f6c37d: Improve React SDK developer experience with staged payment hook APIs and clearer browser integration docs.

  - Add `parseInvoice`, `sendPayment`, and `waitForPayment` to `useFiberPayment` while keeping `payInvoice` compatibility.
  - Document COOP/COEP requirements, expected WASM bundle impact, and retry guidance for startup failures.
  - Clarify React/browser install guidance for `@nervosnetwork/fiber-js` and optional `qrcode.react`.

- d3d5889: Move `@nervosnetwork/fiber-js` from `dependencies` to optional `peerDependencies`, aligning with the pattern already used in `@fiber-pay/sdk`.

  - `@fiber-pay/react/package.json`: remove `@nervosnetwork/fiber-js` from `dependencies`, add to `peerDependencies` and `peerDependenciesMeta.optional`, and add to `devDependencies` for isolated build/test support.
  - `@fiber-pay/react/README.md`: update install command to explicitly include `@nervosnetwork/fiber-js`.

- 53b408e: Add extensibility APIs to `FiberNodeButton` without breaking default behavior:

  - configurable `tabs` (reorder, hide, add custom tabs)
  - `renderTabContent(tabId, context)` for per-tab content override
  - `renderAction(context)` for overriding built-in action UI/behavior
  - `t(key, fallback, vars?)` i18n hook for panel copy customization

  Also update `react-quick-card` with a custom tab mode demo and add tests covering extensibility paths and default compatibility.

- 295ba8c: Refactor `FiberNodeButton` into a directory-based module layout to improve maintainability, while preserving existing public API and runtime behavior.
- b7756c3: Redesign `FiberNodeButton` connected dropdown into a task-oriented tabbed panel:

  - Add a compact global status/header area with clearer selected-tab semantics
  - Split actions into `Workbench`, `Channels`, and `Diagnostics`
  - Add force-close confirmation flow and streamlined channel management UX

  Improve developer dogfood/demo experience in `react-quick-card` by refocusing the page on `FiberNodeButton` integration and runtime callback visibility.

- Updated dependencies [7bc83aa]
- Updated dependencies [b0610f7]
- Updated dependencies [06cfef0]
  - @fiber-pay/sdk@0.2.6

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
