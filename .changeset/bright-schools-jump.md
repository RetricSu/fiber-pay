---
"@fiber-pay/react": patch
---

Update the `react-fiber-node-button-lab` example so the custom CCC wallet connector section is only rendered when external funding mode is enabled.

This aligns the demo UI with the actual channel-open funding flow and avoids showing external wallet controls while internal funding mode is active.
