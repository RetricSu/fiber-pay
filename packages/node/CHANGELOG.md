# @fiber-pay/node

## 0.2.6

### Patch Changes

- Updated dependencies [7bc83aa]
- Updated dependencies [b0610f7]
- Updated dependencies [06cfef0]
  - @fiber-pay/sdk@0.2.6

## 0.2.5

### Patch Changes

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

- Updated dependencies [b049830]
- Updated dependencies [0f6ead3]
- Updated dependencies [713aa2d]
  - @fiber-pay/sdk@0.2.4

## 0.2.3

### Patch Changes

- @fiber-pay/sdk@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [76bbe85]
- Updated dependencies [1e96626]
  - @fiber-pay/sdk@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [dec5314]
- Updated dependencies [3876ef5]
  - @fiber-pay/sdk@0.2.1

## 0.2.0

### Minor Changes

- 872c624: Migrate Fiber integration target to v0.8.0 across SDK, runtime, CLI, agent, and browser-facing flows.

  Key updates include pubkey-based RPC fields, v0.8.0 invoice/hash serialization semantics, downstream compatibility fixes, and aligned documentation/examples.

### Patch Changes

- 43c2cd1: fix: support fnn-migrate v0.8 argument changes and make force migration flow robust when pre-check is unavailable.
- 543461e: feat: add Browser WASM Node and WebAuthn PRF Passkey support
- Updated dependencies [b912f08]
- Updated dependencies [872c624]
- Updated dependencies [543461e]
  - @fiber-pay/sdk@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [d9bd02b]
  - @fiber-pay/sdk@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [cfcfcea]
- Updated dependencies [d0451e9]
- Updated dependencies [4c1c414]
- Updated dependencies [4438b9a]
  - @fiber-pay/sdk@0.1.0

## 0.1.0-rc.7

### Patch Changes

- Updated dependencies [cfcfcea]
- Updated dependencies [d0451e9]
  - @fiber-pay/sdk@0.1.0-rc.7

## 0.1.0-rc.6

### Patch Changes

- @fiber-pay/sdk@0.1.0-rc.6

## 0.1.0-rc.5

### Patch Changes

- Updated dependencies [4c1c414]
- Updated dependencies [4438b9a]
  - @fiber-pay/sdk@0.1.0-rc.5

## 0.1.0-rc.4

### Patch Changes

- cabeae2: Improve upgrade and migration safety/UX:

  - simplify `fiber-pay node upgrade` flags by removing ambiguous `--force`
  - make `--force-migrate` attempt migration even when compatibility pre-check is incompatible
  - normalize migration hints so users are guided by CLI commands instead of raw `fnn-migrate` invocations
  - add strict version-tag validation in binary download flow to prevent malformed/path-like version input
  - add migration/status messaging improvements and post-migration check warning when refresh fails
  - @fiber-pay/sdk@0.1.0-rc.4
