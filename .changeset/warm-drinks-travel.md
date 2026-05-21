---
"@fiber-pay/react": patch
---

Redesign `FiberNodeButton` connected dropdown into a task-oriented tabbed panel:
- Add a compact global status/header area with clearer selected-tab semantics
- Split actions into `Workbench`, `Channels`, and `Diagnostics`
- Add force-close confirmation flow and streamlined channel management UX

Improve developer dogfood/demo experience in `react-quick-card` by refocusing the page on `FiberNodeButton` integration and runtime callback visibility.
