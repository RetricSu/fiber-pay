---
'@fiber-pay/runtime': patch
---

chore(runtime): remove legacy string-literal channel state fallbacks in
`channel-executor`. `state_name` is always a canonical `ChannelState` enum
value after normalization at the SDK boundary, so the redundant
`String(...).toUpperCase()` coercions and `=== 'CLOSED'` /
`=== 'SHUTTING_DOWN'` branches are dead. Tightens helper parameter types
from `string` to `ChannelState`.
