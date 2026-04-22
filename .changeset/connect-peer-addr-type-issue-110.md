---
"@fiber-pay/sdk": minor
"@fiber-pay/cli": minor
---

Add `TransportType` and `addr_type` param to `ConnectPeerParams` for Fiber v0.8.1 (issue #110)

- New `TransportType` union type: `'tcp' | 'ws' | 'wss'`
- `ConnectPeerParams.addr_type` optional field for filtering peer addresses by transport protocol
- CLI `peer connect` now accepts `--addr-type <tcp|ws|wss>` when connecting by pubkey
- Especially useful in WASM/browser environments that only support WSS
- Updated RPC type version comments to v0.8.1
