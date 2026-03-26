# L402 协议集成计划

> 将 [fiber-l402/packages/sdk](https://github.com/RetricSu/fiber-l402/tree/master/packages/sdk) 的 L402 能力直接集成到 `@fiber-pay/sdk` 中，让开发者一个包就能搭建 L402 付费 API 服务。

## 1. 背景

### 什么是 L402

L402（原 LSAT）是一种基于 HTTP 402 状态码 + Macaroon + Lightning Invoice 的付费访问协议。核心流程：

```
客户端请求 → 服务端返回 402 + macaroon + invoice
→ 客户端付款 → 携带 L402 token 重新请求 → 服务端验证 → 200 返回内容
```

### 现状

目前 L402 能力在独立项目 `fiber-l402` 的 `@fiber-l402/sdk` 包中：

```
@fiber-pay/sdk         ← Fiber Network RPC 通信层
  └─ @fiber-l402/sdk   ← L402 协议层（独立包）
      └─ 用户应用       ← 业务逻辑
```

问题：用户需要安装两个包，依赖关系不够直观。

### 目标

将 L402 能力整合进 `@fiber-pay/sdk`，用户只需一个包即可：

```
@fiber-pay/sdk         ← Fiber RPC + L402 协议，一站式
  └─ 用户应用           ← 业务逻辑
```

## 2. 上游 SDK 源码分析

`@fiber-l402/sdk` 有以下核心模块（共约 25KB 源码）：

| 文件 | 核心类/函数 | 职责 | 外部依赖 |
|------|------------|------|---------|
| `macaroon.ts` | `MacaroonService` | Macaroon 铸造 (mint)、验证 (verify)、caveat 提取 | `macaroon` npm 包, Node.js `crypto` |
| `invoice.ts` | `InvoiceService` | 通过 Fiber RPC 创建/查询 invoice | `@fiber-pay/sdk` 的 `FiberRpcClient` |
| `middleware.ts` | `L402Middleware`, `createL402Middleware` | Express 中间件，处理 402 挑战和 token 验证 | Express (peer dep) |
| `resources.ts` | `DefaultResourceResolverRegistry` | 动态资源定价注册表 | Express types |
| `types.ts` | 各种 interface/type | L402 协议类型定义 | Express types |
| `macaroon-module.d.ts` | — | `macaroon` npm 包的类型声明 | — |

### 关键依赖

- **`macaroon`** (npm ^3.0.4)：Macaroon token 的创建与验证，L402 协议的核心
- **`@fiber-pay/sdk`**：已在使用 `FiberRpcClient` 来创建 invoice / 查询支付状态
- **`express`** (peer dep, optional)：中间件层依赖

### MacaroonService 核心行为

```typescript
// 铸造：嵌入 payment_hash、expiry、resource_id 等 caveat
mint(params: MintParams): { macaroon: string; caveats: MacaroonCaveat[] }

// 验证：验签 + preimage hash 对比 + expiry 检查
verify(macaroonB64: string, preimage: string): VerifyResult

// 无 preimage 验证（connected-node 模式，通过 RPC 确认 invoice 是否已付）
verifyWithoutPreimage(macaroonB64: string): VerifyResult
```

### L402Middleware 核心行为

中间件支持两条验证路径：
1. **Path A — 客户端有 preimage**：`Authorization: L402 <macaroon>:<preimage>` → 本地验签
2. **Path B — connected-node 模式**：`Authorization: L402 <macaroon>` → 验签 + 通过 Fiber RPC 检查 invoice 状态

还包含速率限制、资源 caveat 校验、`WWW-Authenticate` header 生成等。

## 3. 集成方案

### 3.1 文件结构

在 `packages/sdk/src/` 下新增 `l402/` 子目录：

```
packages/sdk/src/
├── l402/
│   ├── index.ts              # L402 子模块导出
│   ├── types.ts               # L402 协议类型（去掉 Article 等业务类型）
│   ├── macaroon.ts            # MacaroonService（原样迁入）
│   ├── macaroon-module.d.ts   # macaroon 包的类型声明
│   ├── middleware.ts          # L402Middleware + createL402Middleware
│   └── resources.ts           # DefaultResourceResolverRegistry
├── rpc/
│   └── client.ts              # 现有 FiberRpcClient（不变）
└── index.ts                   # 主入口，增加 L402 导出
```

> **注意**：不需要迁入 `InvoiceService`。上游的 `InvoiceService` 只是对 `FiberRpcClient` 的轻量封装，而 `@fiber-pay/sdk` 已经直接提供了 `FiberRpcClient.newInvoice()` / `getInvoice()` / `getPayment()` 等完整的 invoice 操作方法。middleware 层直接使用 `FiberRpcClient` 即可，这也消除了一层不必要的抽象。

### 3.2 需要做的事情

#### A. 新增 L402 类型 (`l402/types.ts`)

从上游 `types.ts` 迁入，但做以下精简：
- **移除** `Article` 类型（业务类型，不属于 SDK）
- **移除** `PaymentSession` 类型（业务类型）
- **保留** `Invoice`, `L402Token`, `L402Challenge`, `L402Config`, `L402Request`, `L402MiddlewareConfig`, `ChallengeStore`, `ProtectedResourceInfo`, `ResourceResolver`, `ResourceResolverRegistry`
- `Invoice` 类型需评估是否与现有 `@fiber-pay/sdk` 的 RPC types 重名/冲突，可能需要重命名为 `L402Invoice`

#### B. 迁入 MacaroonService (`l402/macaroon.ts`)

基本原样迁入，只做小调整：
- import 路径更新
- 考虑使用 `@noble/hashes`（项目已有依赖）替代 Node.js 内置 `crypto` 模块的 `createHash('sha256')`，提升浏览器兼容性

#### C. 重构 Middleware (`l402/middleware.ts`)

最大的改动点：
- 将 `InvoiceService` 替换为直接使用 `FiberRpcClient`
- middleware 构造时接受 `FiberRpcClient` 实例或 RPC 配置
- invoice 创建/状态查询直接调用 `FiberRpcClient` 方法

```typescript
// 之前（fiber-l402）
constructor(config) {
  this.invoiceService = new InvoiceService();  // 内部创建 FiberRpcClient
}

// 之后（fiber-pay 集成）
constructor(config: L402MiddlewareConfig & { rpcClient?: FiberRpcClient }) {
  this.rpcClient = config.rpcClient || new FiberRpcClient({ url: config.rpcUrl });
}
```

#### D. 迁入 Resources (`l402/resources.ts`)

原样迁入 `DefaultResourceResolverRegistry`。

#### E. 更新主入口 (`src/index.ts`)

增加 L402 相关的 re-export：

```typescript
// L402 protocol
export { MacaroonService, createL402Middleware, L402Middleware, DefaultResourceResolverRegistry } from './l402/index.js';
export type { L402Config, L402Token, L402Challenge, ... } from './l402/index.js';
```

同时提供子路径导出 `@fiber-pay/sdk/l402`，方便按需引入。

#### F. 添加依赖

`package.json` 新增：
```json
{
  "dependencies": {
    "macaroon": "^3.0.4"
  },
  "peerDependencies": {
    "express": "^4.0.0 || ^5.0.0"
  },
  "peerDependenciesMeta": {
    "express": { "optional": true }
  }
}
```

### 3.3 用户使用方式（集成后）

#### 最简用法 — 一行代码保护 Express 路由

```typescript
import express from 'express';
import { createL402Middleware } from '@fiber-pay/sdk';

const app = express();

app.get('/api/premium/*', createL402Middleware({
  rootKey: process.env.L402_ROOT_KEY,
  priceCkb: 0.1,
  expirySeconds: 3600,
}));

app.get('/api/premium/data', (req, res) => {
  res.json({ secret: 'paid content here' });
});
```

#### 动态定价

```typescript
import { L402Middleware, DefaultResourceResolverRegistry, FiberRpcClient } from '@fiber-pay/sdk';

const rpcClient = new FiberRpcClient({ url: 'http://127.0.0.1:8227' });

const registry = new DefaultResourceResolverRegistry([{
  name: 'articles',
  matches: (req) => req.path.startsWith('/api/articles/'),
  resolve: async (req) => ({
    id: req.params.id,
    type: 'article',
    priceCkb: 0.5,
  }),
}]);

const middleware = new L402Middleware({
  rootKey: process.env.L402_ROOT_KEY,
  resourceResolver: registry,
  rpcClient,
});

app.get('/api/articles/:id', middleware.handle.bind(middleware), handler);
```

#### 独立使用 Macaroon

```typescript
import { MacaroonService } from '@fiber-pay/sdk';

const macaroon = new MacaroonService(process.env.L402_ROOT_KEY);
const { macaroon: token } = macaroon.mint({
  identifier: 'order-123',
  paymentHash: '0x...',
  expirySeconds: 3600,
});

const result = macaroon.verify(token, preimage);
```

## 4. 已确认决策

1. **`InvoiceService` 不保留** — middleware 直接使用 `FiberRpcClient`
2. **不需要 subpath export** — 全部从 `@fiber-pay/sdk` 主入口导出
3. **直接使用 `macaroon` npm 包** — 成熟库，不自行实现
4. **不考虑浏览器兼容性** — 面向 Node.js 服务器场景，使用内置 `crypto`

## 5. 实施步骤

| 阶段 | 内容 | 预估 |
|------|------|------|
| 1 | 新建 `l402/` 目录，迁入 types + macaroon + resources | 小 |
| 2 | 重构 middleware，使用 `FiberRpcClient` 替换 `InvoiceService` | 中 |
| 3 | 更新 `index.ts` 导出 + `package.json` 依赖 + tsup 配置 | 小 |
| 4 | 编写单元测试（MacaroonService mint/verify, middleware 逻辑） | 中 |
| 5 | 更新 README + 示例代码 | 小 |
| 6 | 构建验证 + 已有测试回归 | 小 |
