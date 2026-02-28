# Upgrade fiber-pay to Fiber v0.7.1

> Issue: https://github.com/RetricSu/fiber-pay/issues/14
> Fiber v0.7.1 与 v0.6.1 不兼容（onion packet 序列化格式变更、DB migration required）。

## 背景

Fiber 从 v0.6.1 → v0.7.0 → v0.7.1 引入了以下变更：

### 协议级 Breaking Change
- **Onion Packet v1 序列化**：hop data 从 u64 big-endian length header 改为 molecule 原生 u32 little-endian length。v0.6.1 节点无法解析 v0.7.x 发出的 packet，两个版本节点**不能互通**。
- **DB migration required**：新增 one-way channel / trampoline routing 数据结构和 `ChannelOpenRecord` 存储。

### RPC Breaking Change
- CCH order 字段 `expiry` → `expiry_delta_seconds`（重命名）
- CCH order 字段 `ckb_final_tlc_expiry_delta` 移除
- CCH order status 枚举 `OutgoingSettled` → `OutgoingSucceeded`（重命名）
- RPC CORS 默认关闭（之前默认 wildcard `*`）

### RPC 新增参数/字段
- `open_channel`：新增 `one_way?: boolean`
- `Channel` 类型：新增 `is_acceptor: boolean`、`is_one_way: boolean`、`failure_detail?: string`
- `list_channels`：新增 `only_pending?: boolean`
- `new_invoice`：新增 `allow_trampoline_routing?: boolean`
- `send_payment`：新增 `max_fee_rate?: HexString`、`trampoline_hops?: Pubkey[]`
- `send_payment`：新增 `InsufficientBalance` 早期失败

### 新功能（不在本次暴露）
- One-way channels
- Trampoline routing
- Observable channel opening（`ChannelOpenRecord` 生命周期追踪）
- Hold invoice cancel 时正确 fail-back pending TLCs

---

## 升级范围

本次以**兼容性为主**：更新版本号、修正 SDK 类型、更新 config 模板、修正 CCH 类型与文档。新功能仅在 SDK 类型层添加可选字段，CLI/Agent 层暂不暴露新 flag。

---

## Step 1: 版本号更新

将 `DEFAULT_FIBER_VERSION` 从 `'v0.6.1'` 改为 `'v0.7.1'`。

- `packages/node/src/constants.ts` L6

## Step 2: SDK RPC 类型更新

修改 `packages/sdk/src/types/rpc.ts`：

| 位置 | 改动 | 类型 |
|---|---|---|
| L1-L6 | 头部注释版本号 + URL → v0.7.1 | 文档 |
| ~L137 | `Channel` 加 `is_acceptor: boolean`、`is_one_way: boolean` | 必填新字段 |
| ~L155 | `Channel` 加 `failure_detail?: string` | 可选新字段 |
| ~L318 | `OpenChannelParams` 加 `one_way?: boolean` | 可选新参数 |
| ~L351 | `ListChannelsParams` 加 `only_pending?: boolean` | 可选新参数 |
| ~L381 | `SendPaymentParams` 加 `max_fee_rate?: HexString`、`trampoline_hops?: Pubkey[]` | 可选新参数 |
| ~L419 | `NewInvoiceParams` 加 `allow_trampoline_routing?: boolean` | 可选新参数 |
| L528 | `CchOrderStatus`: `'OutgoingSettled'` → `'OutgoingSucceeded'` | 枚举重命名 |

## Step 3: Config 模板更新

修改 `packages/cli/src/lib/config-templates.ts`：

- Testnet 模板：`listening_addr` 从 `/ip4/127.0.0.1/tcp/8228` → `/ip4/0.0.0.0/tcp/8228`
- Testnet 模板：第二个 bootnode IP 从 `54.179.226.154:18228` → `16.163.7.105:8228`
- 常量名 `TESTNET_CONFIG_TEMPLATE_V061` / `MAINNET_CONFIG_TEMPLATE_V061` 重命名为 `_V071`
- `getConfigTemplate` 中的引用同步更新
- 链上脚本 hash (FundingLock/CommitmentLock) 确认不变，保持原样

## Step 4: Node 进程管理 config 同步

检查 `packages/node/src/process/manager.ts` 中内嵌的 `DEFAULT_TESTNET_FIBER_CONFIG`，同步 bootnode 和 listening_addr 变更。

## Step 5: 测试 fixture 更新

以下测试文件中的 mock `Channel` 对象需添加 `is_acceptor`、`is_one_way` 必填字段：

- `packages/sdk/tests/rpc-client.test.ts`（4 处 mock Channel）
- `packages/runtime/tests/channel-monitor.test.ts`
- `packages/runtime/tests/channel-diff.test.ts`
- `packages/runtime/tests/channel-executor.test.ts`
- `packages/runtime/tests/job-manager.test.ts`

## Step 6: 文档版本号批量替换

将所有 `v0.6.1` 引用改为 `v0.7.1`：

- `packages/node/README.md`
- `packages/cli/README.md`
- `packages/sdk/README.md`
- `packages/runtime/README.md`
- `docs/develop.md`
- `skills/fiber-pay/SKILL.md`（description、version、RPC reference URL）

## Step 7: Skill reference 文档更新

修改 `skills/fiber-pay/references/config.md` 和 `skills/fiber-pay/references/fnn.reference.yml`：

- 标题版本号 v0.6.1 → v0.7.1
- CCH 部分：`order_expiry` → `expiry_delta_seconds`，移除 `ckb_final_tlc_expiry_delta`
- 新增 `rpc.cors_enabled`（默认 false）和 `rpc.cors_allowed_origins`（默认 []）配置项说明

---

## 不需要改动的部分

| 项目 | 原因 |
|---|---|
| CORS | runtime proxy 已自行注入 CORS 头 |
| DB migration | 已有 `MigrationManager` 基础设施，`node upgrade --version v0.7.1` 即可 |
| InsufficientBalance 早期失败 | error-classifier 已有 `/insufficient (balance\|capacity\|funds)/i` 匹配 |
| Hold invoice cancel TLC 行为 | 服务端修复，客户端无需变更 |
| Onion packet v1 | 协议层变更，对 RPC 调用方透明 |
| CLI/Agent 新功能 flag | 不暴露 `oneWay`、`trampoline`、`maxFeeRate`，后续单独实现 |
| SDK RPC client (`rpc/client.ts`) | 方法签名透传类型，自动跟随 `rpc.ts` 变化 |
| SDK address/utils/funds/security/verification | 不涉及 RPC 类型变更 |

---

## 验证

- [x] `pnpm build` 所有包编译通过
- [x] `pnpm test` 所有测试通过
- [x] 全局搜索 `v0.6.1` 确认无遗漏引用
- [x] 全局搜索 `OutgoingSettled` 确认无遗漏引用
- [x] `fiber-pay node upgrade --version v0.7.1` 能正确下载新版本二进制
