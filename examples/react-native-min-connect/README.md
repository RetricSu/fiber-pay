# react-native-min-connect

Minimal real React Native/Expo consumer of `@fiber-pay/react-native`.

This isn't meant to be run as a full app (it needs a reachable `fnn` node
URL and a device/emulator). Its purpose is to give the package a real RN
entry point that Metro can bundle, so CI catches RN module-resolution
issues that `tsc` and jsdom-based unit tests can't — see `pnpm smoke`,
which runs `expo export:embed` against `index.ts` without needing a
device or emulator.

```sh
pnpm --filter example-react-native-min-connect typecheck
pnpm --filter example-react-native-min-connect smoke
```
