---
'@fiber-pay/react': minor
---

refactor(react): simplify `ConnectButton` strategy selection by requiring an explicit `password` or `passkey` strategy. The button no longer auto-selects credentials or exposes raw-key connection props; advanced raw-key flows remain available through `useFiberNode().startWithRawKey()`.
