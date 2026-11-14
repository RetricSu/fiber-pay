---
"@fiber-pay/node": patch
"@fiber-pay/sdk": patch
"@fiber-pay/react": patch
"@fiber-pay/react-native": patch
"@fiber-pay/cli": patch
---

Upgrade the Fiber target to fnn v0.10.0 and align `@nervosnetwork/fiber-js` to `~0.10.0`. Add support for additional P2P listening addresses in native and browser config builders and synchronous store writes in native node configs. Use the correct network-specific browser contract deployments, expose Channel V2 watchtower types, and enable authenticated database backups with the upstream `write("node")` rule. Document the Channel V2 interoperability requirements for new channels and verify node versions in native and dual-node smoke tests.
