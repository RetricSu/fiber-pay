# @fiber-pay/agent

## 0.3.0

### Patch Changes

- @fiber-pay/sdk@0.3.0
- @fiber-pay/node@0.3.0
- @fiber-pay/runtime@0.3.0

## 0.2.8

### Patch Changes

- Updated dependencies [240cc94]
- Updated dependencies [42724a3]
- Updated dependencies [2aa9402]
- Updated dependencies [42724a3]
- Updated dependencies [ca02a01]
  - @fiber-pay/node@0.2.8
  - @fiber-pay/sdk@0.2.8
  - @fiber-pay/runtime@0.2.8

## 0.2.7

### Patch Changes

- Updated dependencies [42793f4]
- Updated dependencies [ec536f4]
  - @fiber-pay/node@0.2.7
  - @fiber-pay/sdk@0.2.7
  - @fiber-pay/runtime@0.2.7

## 0.2.6

### Patch Changes

- Updated dependencies [7bc83aa]
- Updated dependencies [b0610f7]
- Updated dependencies [06cfef0]
  - @fiber-pay/sdk@0.2.6
  - @fiber-pay/node@0.2.6
  - @fiber-pay/runtime@0.2.6

## 0.2.5

### Patch Changes

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
- Updated dependencies [32c6228]
  - @fiber-pay/sdk@0.2.5
  - @fiber-pay/node@0.2.5
  - @fiber-pay/runtime@0.2.5

## 0.2.4

### Patch Changes

- Updated dependencies [b049830]
- Updated dependencies [0f6ead3]
- Updated dependencies [713aa2d]
  - @fiber-pay/sdk@0.2.4
  - @fiber-pay/node@0.2.4
  - @fiber-pay/runtime@0.2.4

## 0.2.3

### Patch Changes

- @fiber-pay/sdk@0.2.3
- @fiber-pay/node@0.2.3
- @fiber-pay/runtime@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [76bbe85]
- Updated dependencies [1e96626]
  - @fiber-pay/sdk@0.2.2
  - @fiber-pay/node@0.2.2
  - @fiber-pay/runtime@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [dec5314]
- Updated dependencies [3876ef5]
  - @fiber-pay/sdk@0.2.1
  - @fiber-pay/node@0.2.1
  - @fiber-pay/runtime@0.2.1

## 0.2.0

### Minor Changes

- 872c624: Migrate Fiber integration target to v0.8.0 across SDK, runtime, CLI, agent, and browser-facing flows.

  Key updates include pubkey-based RPC fields, v0.8.0 invoice/hash serialization semantics, downstream compatibility fixes, and aligned documentation/examples.

### Patch Changes

- 543461e: feat: add Browser WASM Node and WebAuthn PRF Passkey support
- Updated dependencies [b912f08]
- Updated dependencies [872c624]
- Updated dependencies [43c2cd1]
- Updated dependencies [543461e]
  - @fiber-pay/sdk@0.2.0
  - @fiber-pay/node@0.2.0
  - @fiber-pay/runtime@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [d9bd02b]
  - @fiber-pay/sdk@0.1.1
  - @fiber-pay/node@0.1.1
  - @fiber-pay/runtime@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [bd992dd]
- Updated dependencies [cabeae2]
- Updated dependencies [3a7ea1b]
- Updated dependencies [eea4e63]
- Updated dependencies [cfcfcea]
- Updated dependencies [d4b2112]
- Updated dependencies [077ec13]
- Updated dependencies [d0451e9]
- Updated dependencies [4c1c414]
- Updated dependencies [2e051f6]
- Updated dependencies [374a7e6]
- Updated dependencies [4438b9a]
- Updated dependencies [5be36b4]
  - @fiber-pay/runtime@0.1.0
  - @fiber-pay/node@0.1.0
  - @fiber-pay/sdk@0.1.0

## 0.1.0-rc.7

### Patch Changes

- Updated dependencies [cfcfcea]
- Updated dependencies [d0451e9]
- Updated dependencies [374a7e6]
  - @fiber-pay/sdk@0.1.0-rc.7
  - @fiber-pay/runtime@0.1.0-rc.7
  - @fiber-pay/node@0.1.0-rc.7

## 0.1.0-rc.6

### Patch Changes

- Updated dependencies [eea4e63]
- Updated dependencies [d4b2112]
- Updated dependencies [2e051f6]
  - @fiber-pay/runtime@0.1.0-rc.6
  - @fiber-pay/sdk@0.1.0-rc.6
  - @fiber-pay/node@0.1.0-rc.6

## 0.1.0-rc.5

### Patch Changes

- Updated dependencies [bd992dd]
- Updated dependencies [077ec13]
- Updated dependencies [4c1c414]
- Updated dependencies [4438b9a]
- Updated dependencies [5be36b4]
  - @fiber-pay/runtime@0.1.0-rc.5
  - @fiber-pay/sdk@0.1.0-rc.5
  - @fiber-pay/node@0.1.0-rc.5

## 0.1.0-rc.4

### Patch Changes

- Updated dependencies [cabeae2]
  - @fiber-pay/node@0.1.0-rc.4
  - @fiber-pay/sdk@0.1.0-rc.4
  - @fiber-pay/runtime@0.1.0-rc.4
