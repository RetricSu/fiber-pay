---
"@fiber-pay/node": patch
"@fiber-pay/sdk": patch
"@fiber-pay/react": patch
"@fiber-pay/react-native": patch
"@fiber-pay/cli": patch
---

Upgrade the Fiber target to fnn v0.10.1 and align `@nervosnetwork/fiber-js` to `~0.10.1`, with a shared machine-readable version source. Add support for additional P2P listening addresses in native and browser config builders and synchronous store writes in native node configs. Share exact fnn mainnet/testnet contract deployments across browser, native, and CLI configs, expose Channel V2 watchtower types, and enable authenticated database backups with the upstream `write("node")` rule. Document Channel V2 interoperability and MPP success semantics, and verify node versions in native and dual-node smoke tests.
