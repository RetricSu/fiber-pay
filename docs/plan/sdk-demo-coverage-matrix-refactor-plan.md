# SDK 示范覆盖矩阵重构计划（从头实施）

- 日期：2026-05-25
- 状态：提案
- 目标：按 SDK 能力分层重建示例体系，减少重叠和命名歧义

## 1. 是否可行

可以直接按以下四层开工，这四层已经覆盖当前对外示范主路径：

1. React 接入层：useFiberNode + ConnectButton（最小接入）
2. React 组件层：FiberNodeButton（默认与自定义 tabs）
3. Browser SDK 层：@fiber-pay/sdk/browser（BrowserRpcClient + browser-only helper）
4. Universal SDK 层：@fiber-pay/sdk（FiberRpcClient，Node/脚本）

该矩阵与当前包边界一致，不会引入反向依赖。

## 2. 推荐目标结构

建议按“示范层”组织，而不是按历史 app 名字组织。

- examples/
  - react-min-connect/
  - react-fiber-node-button-lab/
  - browser-sdk-playground/
  - sdk-node-recipes/

说明：

1. 浏览器交互应用与 Node 脚本配方统一放在 examples，按“层级”区分。
2. 目录命名直接对应 SDK 覆盖矩阵，避免历史命名带来的理解成本。

## 3. 每层示范边界（必须展示）

### 3.1 React 接入层（react-min-connect）

目标：让新用户 5 分钟完成接入。

必须展示：

1. useFiberNode 初始化（network + walletId）
2. ConnectButton 两种策略切换（password/passkey）
3. onConnect/onDisconnect/onError 基础事件日志
4. 最小状态可视化（state、pubkey、isRunning）

明确不做：

1. 通道管理
2. 图网络诊断
3. 复杂面板交互

### 3.2 React 组件层（react-fiber-node-button-lab）

目标：完整展示 FiberNodeButton 的默认能力和扩展能力。

必须展示：

1. 默认 tabs 与默认动作
2. 自定义 tabs（新增 tab、隐藏 diagnostics）
3. renderAction 自定义按钮
4. t 文案覆盖（最小 i18n）
5. externalFunding.resolve 回调接入示例

明确不做：

1. 业务化大屏控制台
2. 与接入层重复的教程叙事

### 3.3 Browser SDK 层（browser-sdk-playground）

目标：脱离 React 抽象，直接展示 browser SDK API 组合方式。

必须展示：

1. BrowserRpcClient 或 @fiber-pay/sdk/browser 导出的 FiberRpcClient
2. browser-only helper（如脚本地址转换、余额查询等）
3. 关键调用链：node_info/list_peers/list_channels/new_invoice/send_payment/get_payment
4. 浏览器环境约束提示（WS/WSS、安全上下文等）

明确不做：

1. React 组件封装能力讲解
2. FiberNodeButton 交互设计演示

### 3.4 Universal SDK 层（sdk-node-recipes）

目标：提供可复制的 Node 侧脚本配方。

必须展示：

1. FiberRpcClient 基础初始化（RPC_URL）
2. 典型脚本：basic-payment、hold-invoice、channel-lifecycle、watch-incoming
3. waitForPayment/waitForChannelReady/watchIncomingPayments
4. 标准错误处理与退出码

明确不做：

1. 浏览器 WASM 细节
2. React UI 逻辑

## 4. 命名和文档规范

### 4.1 命名规则

1. 示例目录名使用“能力 + 场景”，避免 quick-card、wallet-demo 等历史临时名。
2. README 第一行必须包含：层级定位 + 适用人群 + 不覆盖范围。

### 4.2 每层 README 模板

每个示例都统一包含：

1. 这是哪一层
2. 你将学到什么
3. 不会学到什么
4. 运行步骤
5. API 索引（列出实际调用方法）
6. 下一步去哪一层

## 5. 渐进迁移顺序（低风险）

### Phase 1（先立新，不破旧）

1. 创建四层新目录与 README 骨架
2. 将现有示例内容映射到新目录（先复制后收敛）
3. 在根 README 增加“示例矩阵导航”

### Phase 2（收敛内容）

1. 删除各层重复逻辑和重复文案
2. 提炼 shared 工具（脚本日志、环境变量校验）
3. 对齐 Browser 与 Universal 两层的 API 边界说明

### Phase 3（清理旧路径）

1. 废弃旧目录（保留 1 个版本过渡说明）
2. 更新 docs 内全部旧路径引用
3. 清理失效 hooks 与死代码

## 6. 验收标准

1. 四层均可独立运行。
2. 任一示例首页 30 秒内能看懂“本层做什么/不做什么”。
3. 示例间不存在同一能力的重复主讲。
4. 根 README 能从矩阵一跳到任一示例。
5. lint、build、typecheck 通过。

## 7. 当前仓库映射建议

建议作为起步映射：

1. examples/react-min-connect -> React 接入层
2. examples/react-fiber-node-button-lab -> React 组件层
3. examples/browser-sdk-playground -> Browser SDK 层
4. examples/sdk-node-recipes -> Universal SDK 层

## 8. 决策建议

建议直接按这四层执行，不再引入第 5 层。当前阶段最重要的是：

1. 明确层边界
2. 统一命名
3. 消除重复

当四层稳定后，再考虑是否新增“端到端业务流层”（可选）。
