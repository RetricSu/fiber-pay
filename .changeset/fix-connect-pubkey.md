---
"@fiber-pay/cli": minor
---

fix(cli): support pubkey in peer connect and unify pubkey terminology for v0.8.0

- `peer connect` now accepts both pubkey and multiaddr
- removed peerId display from peer connect output
- renamed peerId -> pubkey in formatChannel JSON fields
- removed peerId from node-status output, show Pubkey instead
- updated rebalance error messages/details to use pubkey terminology
