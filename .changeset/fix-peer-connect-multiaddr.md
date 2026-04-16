---
"@fiber-pay/cli": patch
---

fix(cli): auto-build multiaddr from pubkey + address in peer connect

- `peer connect <pubkey> --address <bare-multiaddr>` now automatically computes the peerId from the pubkey and appends `/p2p/<peerId>` to the address before sending the RPC call
- `peer connect <pubkey>` still sends `{ pubkey }` and relies on graph resolution
- `peer connect <multiaddr-with-p2p>` still sends `{ address }` directly
- improved error message when a bare multiaddr is passed as the sole positional argument
