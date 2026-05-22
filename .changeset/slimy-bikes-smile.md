---
"@fiber-pay/react": minor
---

Add extensibility APIs to `FiberNodeButton` without breaking default behavior:
- configurable `tabs` (reorder, hide, add custom tabs)
- `renderTabContent(tabId, context)` for per-tab content override
- `renderAction(context)` for overriding built-in action UI/behavior
- `t(key, fallback, vars?)` i18n hook for panel copy customization

Also update `react-quick-card` with a custom tab mode demo and add tests covering extensibility paths and default compatibility.
