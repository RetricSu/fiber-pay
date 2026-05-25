# ConnectButton + External Wallet 方案确认稿

- 日期：2026-05-14
- 状态：待你确认后进入实现
- 背景：支持 Fiber `v0.8.1` external funding RPC，并在 React 侧提供更灵活的连接构建方式

## 本次确认的核心需求

`ConnectButton` 需要支持以下能力：

1. 在 `passkey` 模式下，可选择是否启用 external wallet。
2. 在 `password` 模式下，也可选择是否启用 external wallet。
3. external wallet 是一个独立开关，不与连接策略强绑定。
4. 组件使用方可按业务场景自由组合，形成更丰富的接入方式。

简化理解：

- 连接策略（`passkey` / `password`）解决“节点身份凭证”问题。
- external wallet 开关解决“是否由外部钱包承担 funding 签名”问题。
- 两者是正交维度，可组合。

## 关键更正（你刚指出的问题）

这次实现范围不是只改 React。

本需求必须是 **Core SDK + React SDK 联动**：

1. Core SDK 先补齐 external funding RPC 的类型与调用封装。
2. React SDK 再在此基础上做 connect 组合能力（passkey/password x external wallet）。

否则 React 侧只有参数开关，没有底层 RPC 能力承接，会造成能力不完整。

## 产品行为矩阵（确认版）

| 连接策略 | external wallet | 预期行为 |
| --- | --- | --- |
| passkey | false | 现有默认行为，节点内置 funding 路径 |
| passkey | true | passkey 管理节点身份，funding 签名走 external wallet |
| password | false | 现有默认行为，节点内置 funding 路径 |
| password | true | password 管理节点身份，funding 签名走 external wallet |

## API 设计（拟定）

### ConnectButton

- `strategy?: "passkey" | "password"`
  - 可选；未传时默认 `passkey`。
- `externalWallet?: boolean`
  - 可选；默认 `false`。
  - `true` 表示启用 external funding 模式（由外部钱包签 funding tx）。

### FiberProvider / useFiberNode（透传能力）

- 增加 `externalWallet?: boolean`（或等价命名）配置，并向下游 credential provider 传递。
- 当 `externalWallet = true` 时，在 passkey 与 password 两种 provider 下都启用 `skipCkbKey` 路径。

## 兼容性策略

1. 向后兼容：
   - 旧用法（仅传 `strategy`）保持行为不变。
   - 不传 `externalWallet` 时默认 `false`。
2. 渐进升级：
   - 仅新增可选参数，不破坏现有 props。
3. 文档同步：
   - README、示例代码、类型注释同步更新，明确组合用法。

## 代码改动范围（规划）

1. Core SDK（本轮必做）
   - `packages/sdk/src/types/rpc.ts`
   - `packages/sdk/src/types/fiber-client.ts`
   - `packages/sdk/src/rpc/client.ts`
   - `packages/sdk/src/browser/wasm-adapter.ts`
   - `packages/sdk/src/browser/fiber-browser-node.ts`
   - `packages/sdk/src/security/biscuit-policy.ts`（补方法级权限映射）
   - `packages/sdk/src/**/tests/*`（补对应 RPC 与类型回归）
2. React 组件与 Hook
   - `packages/react/src/connect-button.tsx`
   - `packages/react/src/use-fiber-node.ts`
   - `packages/react/src/fiber-pay-provider.tsx`（若需新增 provider 配置透传）
3. React 类型与导出
   - `packages/react/src/types/*`（如有）
   - `packages/react/src/index.ts`（如有新增类型导出）
4. 示例与文档
   - `examples/react-fiber-node-button-lab/src/*`
   - `packages/react/README.md`
   - `packages/sdk/README.md`（补 external funding RPC 用法）
   - 根文档中相关片段

## 验收标准

1. SDK 暴露并打通以下 RPC：
   - `open_channel_with_external_funding`
   - `submit_signed_funding_tx`
2. SDK 在 browser 路径与 RPC client 路径都可调用上述方法，类型完整且对齐 Fiber `v0.8.1`。
3. `passkey + externalWallet=true` 可正常启动并进入 external funding 流程。
4. `password + externalWallet=true` 可正常启动并进入 external funding 流程。
5. `passkey/password + externalWallet=false` 保持现有行为。
6. `ConnectButton` 参数组合在类型层可被正确约束，IDE 提示清晰。
7. 示例应用至少提供 2 个组合示例（例如 passkey+external 与 password+internal）。

## 非目标（本轮不做）

1. 不在本轮改造 runtime job 编排到 external funding 完整自动化。
2. 不新增资源级权限策略（仅保持现有方法级边界）。
3. 不修改既有支付业务流程语义，仅扩展连接与 funding 组合能力。

## 实施顺序（确认后执行）

1. 先改 Core SDK（RPC 类型、client、wasm adapter、browser node、权限映射、测试）。
2. 再改 React API（props/hook/provider 透传）。
3. 再改示例应用与 README（SDK 与 React 两侧文档同步）。
4. 最后补测试与回归（SDK + React 的关键分支覆盖）。

## 待你最终确认

1. `strategy` 默认值是否确认使用 `passkey`。
2. external wallet 参数命名是否确认为 `externalWallet`。
3. 示例展示优先级：
   - A. passkey + externalWallet
   - B. password + externalWallet
   - C. 两者都展示（推荐）
