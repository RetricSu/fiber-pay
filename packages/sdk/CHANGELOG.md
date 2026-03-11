# @fiber-pay/sdk

## 1.0.0

### Minor Changes

- 4c1c414: Add Biscuit auth support for CLI RPC calls and introduce SDK Biscuit policy helpers.

  - CLI: support `--rpc-biscuit-token` and `FIBER_RPC_BISCUIT_TOKEN`, then forward token to SDK RPC client as `Authorization: Bearer <token>`
  - SDK: add `biscuit-policy` helpers for upstream-aligned method-to-permission mapping and datalog fact generation
  - Docs: move auth guidance into skill references and add cross-links (`skills/fiber-pay/references/auth.md`)
  - Tests: add coverage for CLI auth config resolution and SDK biscuit policy helper

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

- 4438b9a: Add dual-layer CLI support for rebalancing with both technical and high-level entries.

  - Add technical `payment rebalance` for direct route control (`--hops`) and auto mode (`--max-fee`)
  - Add high-level `channel rebalance` wrapper with optional guided mode via `--from-channel` + `--to-channel`
  - Rebalance orchestration uses circular self-payment via `send_payment` / `send_payment_with_router` with `allow_self_payment: true`
  - Add `--allow-self-payment` flag to `payment send-route`
  - Extend SDK router payment params type with `allow_self_payment`

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
