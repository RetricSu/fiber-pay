---
'@fiber-pay/node': minor
'@fiber-pay/cli': minor
'@fiber-pay/sdk': minor
'@fiber-pay/react': patch
---

Upgrade default Fiber target to fnn v0.9.0-rc4

- Remove support for the standalone `fnn-migrate` binary shipped with new fnn releases.
- Add a legacy migration path that uses the v0.8.1 `fnn-migrate` to bring old stores up to the v0.9.0 epoch.
- `node start` now auto-confirms fnn's built-in migration prompt.
- SDK gains `listPayments` and node config gains v0.9.0-rc4 optional fields.
