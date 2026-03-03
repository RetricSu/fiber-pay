# Auth 推进计划（细颗粒度权限）

- 日期：2026-03-03
- 范围：优先补文档与 CLI 体验，同时一次性补齐端到端可用链路
- 粒度：按 RPC 方法级权限控制（本轮不引入资源级复杂策略）

## 目标

围绕本地节点 + 第三方应用（如 fiber-audio-player）场景，形成可落地的授权闭环：

1. 节点启动时可明确开启 RPC 鉴权。
2. CLI 交互调用时可明确携带并管理授权 token。
3. runtime/agent 能贯通 token 到 Fiber RPC 调用链路。
4. 支持方法级最小权限授权模板，满足第三方应用接入。
5. 文档从主 README/docs 可直接找到与执行，不依赖 skill 私有文档。

## 当前现状总结

- 已有能力：
  - CLI 支持 `--rpc-biscuit-token` 与 `FIBER_RPC_BISCUIT_TOKEN`。
  - SDK 已有 RPC 方法到权限事实（facts）的映射能力。
- 主要缺口：
  - 节点启动“开启鉴权”入口不够显式（模板/流程不闭环）。
  - runtime 与 agent 的 token 配置链路不完整。
  - runtime proxy/job/monitor 未形成方法级授权执行面。
  - 主文档入口缺少 auth 端到端操作指引。

## 实施步骤

1. **统一 Auth 文档基线**
   - 对齐并整合现有 auth 内容到主文档入口。
   - 将技能文档中的关键操作迁移到公开文档（README、human-quickstart）。

2. **补齐 CLI 启动节点鉴权体验**
   - 提供更直接的 `rpc.biscuit_public_key` 配置引导与模板支持。
   - 保持与现有 `config set` 流程一致。

3. **补齐 CLI 交互授权文档闭环**
   - 明确 token 来源优先级（CLI 参数 > 环境变量 > 未设置）。
   - 增加常见错误与排查流程（401/403、token 格式、节点配置缺失）。

4. **贯通 runtime/agent 的 token 传递**
   - 在 runtime/agent 配置层增加 biscuit token 输入项。
   - FiberRpcClient 初始化时注入 token，打通服务内调用链路。

5. **落地方法级细粒度授权执行面**
   - 在 runtime proxy 增加方法 allowlist/scope 的授权中间层。
   - 覆盖 RPC 转发、jobs、monitor 入口的一致鉴权行为。

6. **提供第三方应用最小权限模板**
   - 基于 SDK 方法映射产出“audio player 最小 RPC 方法集”模板。
   - 给出 token 生成/配置/接入示例，供 demo 直接使用。

7. **补全测试与回归**
   - CLI：auth 配置优先级与参数行为测试。
   - runtime：未授权拒绝、授权放行、越权方法拒绝。
   - SDK：方法映射模板稳定性与向后兼容检查。

8. **发布与迁移说明**
   - 更新各包 README 与 CHANGELOG。
   - 标注默认行为、兼容性影响与升级步骤。

## 验收标准

- 节点可通过明确流程开启 RPC 鉴权。
- CLI 在所有交互命令中可稳定使用 token。
- runtime/agent 内部调用不会因缺失 token 造成隐式失败。
- 第三方应用可使用“方法级最小权限 token”完成受限调用。
- 文档可被新用户独立执行，完成从配置到验证的全流程。

## 风险与边界

- 本轮不实现资源级（如 channel_id、金额上限）策略执行，只实现方法级。
- 上游 Fiber 对某些权限事实语义若有变化，需要在后续版本适配。
- 若 runtime 代理默认用于本机可信场景，需明确第三方接入时的威胁模型与默认安全配置。

## 建议里程碑

- M1：文档与 CLI 鉴权入口补齐。
- M2：runtime/agent token 链路打通。
- M3：方法级授权执行面 + 第三方模板 + 测试回归。
- M4：README/CHANGELOG 收口与发布。
