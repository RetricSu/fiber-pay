# @fiber-pay/sdk

## 0.2.4

### Patch Changes

- b049830: Add shared `IFiberClient` interface for browser/RPC API parity (issue #95)

  - New `IFiberClient` interface type enabling polymorphic usage of `FiberRpcClient` and `FiberBrowserNode`
  - `FiberBrowserNode.nodeInfo()` added (canonical); `getNodeInfo()` deprecated
  - `FiberBrowserNode.settleInvoice()` added (was missing)
  - `FiberRpcClient` mutation methods now return `void` instead of `null`
  - Both classes declare `implements IFiberClient`

- 0f6ead3: Add `TransportType` and `addr_type` param to `ConnectPeerParams` for Fiber v0.8.1 (issue #110)

  - New `TransportType` union type: `'tcp' | 'ws' | 'wss'`
  - `ConnectPeerParams.addr_type` optional field for filtering peer addresses by transport protocol
  - CLI `peer connect` now accepts `--addr-type <tcp|ws|wss>` when connecting by pubkey
  - Especially useful in WASM/browser environments that only support WSS
  - Updated RPC type version comments to v0.8.1

- 713aa2d: feat(sdk,react): re-export common browser types and utilities

## 0.2.3

## 0.2.2

### Patch Changes

- 76bbe85: Relax browser passkey policy to allow non-platform authenticators (including Linux setups) while still requiring secure context, WebAuthn support, and PRF capability.

  Also remove forced `authenticatorSelection.authenticatorAttachment = "platform"` during passkey registration.

- 1e96626: fix: improve PRF detection for Chrome on Linux

  - Remove fallback detection that triggered unwanted passkey UI
  - When getClientCapabilities() returns prf: undefined (Chrome on Linux),
    return 'unknown' status instead of attempting detection
  - Update UI to show passkey option when capability is 'unknown',
    allowing users to try passkey on platforms with incomplete capability reporting

## 0.2.1

### Patch Changes

- dec5314: # @fiber-pay/sdk

  Add a browser-safe typed RPC client export in `@fiber-pay/sdk/browser`.

  - Export `FiberRpcClient` and `RpcClientConfig` from browser entry
  - Add `BrowserRpcClient` and `BrowserRpcClientConfig` aliases for clearer frontend DX
  - Document browser RPC client usage in SDK README

- 3876ef5: # @fiber-pay/sdk

  Refine SDK entrypoint boundaries for better browser safety and developer experience.

  - Add `@fiber-pay/sdk/node` subpath export for Node-focused APIs
  - Move L402 server exports (`createL402Middleware`, `MacaroonService`, etc.) out of root entry
  - Keep root entry (`@fiber-pay/sdk`) focused on universal/browser-safe APIs
  - Update docs and internal usage examples to import L402 APIs from `@fiber-pay/sdk/node`

## 0.2.0

### Minor Changes

- 872c624: Migrate Fiber integration target to v0.8.0 across SDK, runtime, CLI, agent, and browser-facing flows.

  Key updates include pubkey-based RPC fields, v0.8.0 invoice/hash serialization semantics, downstream compatibility fixes, and aligned documentation/examples.

### Patch Changes

- b912f08: chore: update browser sdk entrypoint exports for wallet integrations
- 543461e: feat: add Browser WASM Node and WebAuthn PRF Passkey support

## 0.1.1

### Patch Changes

- d9bd02b: Add L402 protocol support

  - **SDK**: New `L402Middleware`, `MacaroonService`, and `createL402Middleware` for building payment-gated APIs using the L402 protocol with Fiber Lightning Network
  - **CLI**: New `l402 proxy` command for reverse-proxying any HTTP service behind L402 payment
  - **CLI**: New `agent serve` and `agent call` commands for paid AI agent services via acpx

## 0.1.0

## 0.1.0-rc.7

### Patch Changes

- cfcfcea: Fix HashAlgorithm casing mismatch with FNN RPC. Add internal value mapping in `newInvoice` to convert PascalCase (`'CkbHash' | 'Sha256'`) to snake_case (`'ckb_hash' | 'sha256'`) before sending to FNN v0.7.1 RPC, maintaining backward compatibility.

  See https://github.com/RetricSu/fiber-pay/issues/66

- d0451e9: Add payment hash helper functions for HashAlgorithm (CkbHash / Sha256)

  - `hashPreimage(preimageHex, algorithm)`: Compute payment hash from preimage
  - `verifyPreimageHash(preimageHex, paymentHash, algorithm)`: Verify preimage matches hash
  - `ckbHash(data)`: Low-level CKB blake2b-256 with "ckb-default-hash" personalization
  - `sha256Hash(data)`: Low-level SHA-256

  Uses browser-compatible implementation (no Buffer dependency).
  Closes #65

## 0.1.0-rc.6

## 0.1.0-rc.5

### Minor Changes

- 4c1c414: Add Biscuit auth support for CLI RPC calls and introduce SDK Biscuit policy helpers.

  - CLI: support `--rpc-biscuit-token` and `FIBER_RPC_BISCUIT_TOKEN`, then forward token to SDK RPC client as `Authorization: Bearer <token>`
  - SDK: add `biscuit-policy` helpers for upstream-aligned method-to-permission mapping and datalog fact generation
  - Docs: move auth guidance into skill references and add cross-links (`skills/fiber-pay/references/auth.md`)
  - Tests: add coverage for CLI auth config resolution and SDK biscuit policy helper

### Patch Changes

- 4438b9a: Add dual-layer CLI support for rebalancing with both technical and high-level entries.

  - Add technical `payment rebalance` for direct route control (`--hops`) and auto mode (`--max-fee`)
  - Add high-level `channel rebalance` wrapper with optional guided mode via `--from-channel` + `--to-channel`
  - Rebalance orchestration uses circular self-payment via `send_payment` / `send_payment_with_router` with `allow_self_payment: true`
  - Add `--allow-self-payment` flag to `payment send-route`
  - Extend SDK router payment params type with `allow_self_payment`

## 0.1.0-rc.4
