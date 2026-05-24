---
"@fiber-pay/react": patch
---

Move `@nervosnetwork/fiber-js` from `dependencies` to optional `peerDependencies`, aligning with the pattern already used in `@fiber-pay/sdk`.

- `@fiber-pay/react/package.json`: remove `@nervosnetwork/fiber-js` from `dependencies`, add to `peerDependencies` and `peerDependenciesMeta.optional`, and add to `devDependencies` for isolated build/test support.
- `@fiber-pay/react/README.md`: update install command to explicitly include `@nervosnetwork/fiber-js`.
