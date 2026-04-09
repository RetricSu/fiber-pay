# @fiber-pay/node

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
