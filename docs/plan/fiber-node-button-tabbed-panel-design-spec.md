# FiberNodeButton 分 Tab 重构设计规格（交付开发）

- 日期：2026-05-21
- 状态：已实现（v0.2.5）
- 目标页面：react-quick-card 中的 FiberNodeButton 已连接下拉面板
- 设计范围：仅重构面板的信息架构与交互，不改底层 SDK RPC 语义

## 1. 背景与问题定义

当前面板采用纵向堆叠的 Connection / Peers&Graph / Channels / Payments 结构，已出现以下问题：

1. 面板过长，单屏无法覆盖核心操作。
2. 任务路径不清晰，用户需要先阅读大量状态信息。
3. 技术诊断信息与高频任务信息混排，认知负担过高。
4. 通道列表卡片密度高，纵向滚动成本大。
5. 危险操作虽有样式区分，但仍暴露在高频区域，决策成本高。

## 2. 重构目标

1. 将“单页长滚动”改为“任务分层 + Tab 切换”。
2. 首屏聚焦高频任务，确保大部分操作在单屏完成。
3. 技术诊断信息下沉到独立 Tab，默认不打扰。
4. 保持现有 props 与 RPC 行为兼容，优先做 UI/UX 重构。

## 3. 信息架构（IA）

新面板采用 2 层结构：

1. 全局状态条（跨 Tab 固定可见）
2. Tab 内容区（按任务分域）

### 3.1 全局状态条（固定）

展示最小决策信息：

1. Node 状态（running / idle / error）
2. Funding 模式（Internal / External）
3. 活跃通道数（Active）
4. 最近错误状态（有错显示红点 + 文案）

全局动作：

1. Disconnect
2. Close Panel

### 3.2 Tab 定义

使用 3 个主 Tab（任务导向）：

1. 操作台（默认）
2. 通道管理
3. 网络诊断

说明：

1. 不再使用“Connection / Peers / Graph / Channels / Payments”作为主导航。
2. Peers 与 Graph 从主流程中移除，统一进入“网络诊断”。

## 4. 布局与内容规范

### 4.1 Tab: 操作台（默认 Tab）

目标：新用户进入后无需理解底层概念即可完成关键动作。

包含模块：

1. 连接准备卡
2. 开通道卡
3. 支付卡

模块顺序：连接准备 -> 开通道 -> 支付

字段与动作：

1. 连接准备卡
- 展示：当前连接状态、外部钱包状态（若开启）
- 动作：Connect External Wallet / Switch / Disconnect

2. 开通道卡
- 输入：Target Peer Pubkey
- 输入：Funding Amount（CKB，强制显示单位）
- 主按钮：Open Channel
- 辅助信息：最近一次开通道结果、建议金额

3. 支付卡
- 动作：Create Invoice (1 CKB)
- 输入：Invoice
- 主按钮：Pay Invoice
- 结果：支付状态标签（Succeeded / Failed / Pending）

交互约束：

1. 未连接时，开通道与支付主按钮 disabled。
2. 按钮 loading 与 disabled 状态明确且互斥。
3. 错误提示优先显示最近操作错误，不堆叠多个错误块。

### 4.2 Tab: 通道管理

目标：对已有通道进行查看、筛选、管理，避免干扰主任务。

包含模块：

1. 通道状态摘要（Active / Pending / Closed）
2. 筛选器（active / pending / closed / all）
3. 通道列表（紧凑行，不再默认大卡）
4. 通道详情面板（点选行后展开）

通道列表行最小信息：

1. Channel ID（短）
2. Peer（短）
3. State Badge
4. Local / Remote Balance（简写）

详情面板信息：

1. 完整 Channel ID
2. 余额与 TLC 细节
3. failure_detail
4. shutdown tx hash

动作策略：

1. Close Channel 作为常规按钮。
2. Force Close 作为危险按钮，仅在详情面板出现。
3. Pending 状态展示 Abandon Pending。

确认策略：

1. Force Close 触发二次确认。
2. 确认文案必须包含后果说明，不使用仅“是否确认”的弱文案。

### 4.3 Tab: 网络诊断

目标：将专家向信息集中，避免污染主操作路径。

包含模块：

1. 已连接 Peers
2. Connect Peer（address 输入 + connect）
3. Graph Snapshot
4. 最近日志（可选，后续迭代）

展示策略：

1. Graph 明确标注采样范围，例如 showing X of N nodes。
2. 默认折叠原始长文本，按需展开。

## 5. 关键交互规则

1. Tab 切换不丢状态。
2. 输入内容与筛选条件跨 Tab 保留，直到面板关闭。
3. 面板关闭后重开，恢复默认 Tab 为“操作台”。
4. 错误提示采用单一错误槽位（latest error slot）。
5. 成功反馈使用短时 status 文案，避免长期占位。

## 6. 响应式规范

### 6.1 Desktop

1. 面板宽度：420 到 480。
2. 内容区最大高度：视口高度的 70% 到 75%。
3. Tab 内容区内部滚动，状态条与 Tab 栏固定。

### 6.2 Mobile

1. Tab 栏采用等宽 segmented control。
2. 内容单列布局。
3. 操作按钮宽度占满容器，减少误触。

## 7. 可访问性（A11y）

1. Tab 使用 aria-role="tablist/tab" 与可见焦点样式。
2. 所有 icon-only 动作提供 aria-label。
3. 颜色不是唯一状态信号，需配合文本与图标。
4. 危险动作确认弹层支持键盘 Esc 关闭。

## 8. 文案与术语规范

1. 面向普通用户的主路径避免裸露术语。
2. TLC 在首次出现处增加释义 tooltip。
3. Funding Amount 永远附带单位 CKB。
4. Graph sample 文案统一为：showing X of N nodes, Y of M channels。

## 9. 技术实现建议（React）

建议拆分组件，降低单文件复杂度：

1. FiberNodePanelShell
2. FiberNodeGlobalStatusBar
3. FiberNodeTabs
4. FiberNodeWorkbenchTab
5. FiberNodeChannelsTab
6. FiberNodeDiagnosticsTab

状态管理建议：

1. 保留现有 hooks：useFiberNode / useFiberPayment / useChannelOpenFlow
2. 新增本地 UI 状态：activeTab、selectedChannelId、forceCloseConfirmOpen
3. 将列表刷新逻辑集中到统一 actions，减少重复 loading 状态

兼容性要求：

1. FiberNodeButton 对外 props 不破坏。
2. renderConnectorSection 仍在“操作台-连接准备卡”可用。

## 10. 事件埋点建议

1. fiber_panel_tab_switched
2. fiber_channel_force_close_confirm_opened
3. fiber_channel_force_close_confirmed
4. fiber_panel_primary_action_clicked
5. fiber_panel_error_shown

埋点字段建议：

1. tab_name
2. channel_state
3. external_wallet_enabled
4. node_state

## 11. 实施分期

### Phase 1（快速落地，1 到 2 天）

1. 引入 Tab 架构与全局状态条。
2. 将 Peers + Graph 迁移到“网络诊断”。
3. 完成“操作台”主流程整合。
4. 保持现有数据获取与 action 逻辑。

### Phase 2（体验强化，2 到 3 天）

1. 通道列表改为紧凑行 + 详情面板。
2. Force Close 二次确认弹层。
3. 统一错误槽位与短时成功反馈。

### Phase 3（优化，按需）

1. 日志分组与搜索。
2. 通道列表虚拟滚动。
3. 新手引导文案与空状态优化。

## 12. 验收标准（交付 QA）

1. 默认打开面板时进入“操作台”Tab。
2. 用户可在单屏内完成 connect -> open channel -> pay 主路径。
3. Peers / Graph 信息不出现在默认首屏。
4. Force Close 具备二次确认与后果文案。
5. 切换 Tab 不丢输入状态。
6. 所有按钮在 loading/disabled 上行为一致。
7. format、lint、typecheck、test 全部通过。

## 13. 非目标

1. 本轮不调整底层 RPC 接口。
2. 本轮不引入全新设计系统。
3. 本轮不重写 node 运行时状态机。

## 14. 设计评审待确认项

1. Tab 文案使用“操作台/通道管理/网络诊断”还是英文版本。
2. 通道详情面板采用 inline 展开还是右侧抽屉。
3. Force Close 确认层采用 Popover 还是 Dialog。
