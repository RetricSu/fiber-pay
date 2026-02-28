# @fiber-pay/agent

AI-agent orchestration layer for Fiber Network (targeting Fiber `v0.7.1`).

This package provides:

- `FiberPay`: high-level, agent-friendly API on top of `@fiber-pay/sdk` + `@fiber-pay/node`
- `MCP_TOOLS`: MCP tool schema definitions for model/tool integration

## What this package is (and is not)

`@fiber-pay/agent` is an orchestration layer, not a separate protocol implementation.
It composes existing SDK and node lifecycle capabilities into one API designed for autonomous agents.

It currently exports MCP tool **definitions/schemas**; host-side tool execution wiring is still your responsibility.

## Install

```bash
pnpm add @fiber-pay/agent
```

## Quick start

```ts
import { createFiberPay } from '@fiber-pay/agent';

const fiber = createFiberPay({
  dataDir: `${process.env.HOME}/.fiber-pay`,
  network: 'testnet',
});

const init = await fiber.initialize();
if (!init.success) throw new Error(init.error?.message ?? 'init failed');

const balance = await fiber.getBalance();
console.log(balance.data);

await fiber.shutdown();
```

## Runtime job orchestration

By default, `FiberPay` enables runtime-backed job orchestration for:

- `pay()`
- `createInvoice()`
- `createHoldInvoice()`
- `settleInvoice()`
- `openChannel()`
- `closeChannel()`

This uses an internal SQLite job store and waits for terminal job states before returning.

Config knobs:

- `useRuntimeJobs` (default: `true`)
- `runtimeJobsDbPath` (default: `${dataDir}/runtime-jobs.db`)

Disable orchestration to force direct RPC calls:

```ts
const fiber = createFiberPay({
  dataDir: `${process.env.HOME}/.fiber-pay`,
  useRuntimeJobs: false,
});
```

## API surface summary

### Lifecycle

- `initialize()`
- `shutdown()`

### Payments and invoices

- `pay()`
- `createInvoice()`
- `getPaymentStatus()`
- `getInvoiceStatus()`
- `createHoldInvoice()`
- `settleInvoice()`
- `waitForPayment()`

### Channels and node state

- `listChannels()`
- `openChannel()`
- `closeChannel()`
- `waitForChannelReady()`
- `getNodeInfo()`
- `getBalance()`

### Safety, verification, and observability

- `validateInvoice()`
- `analyzeLiquidity()`
- `canSend()`
- `getPaymentProof()`
- `getPaymentProofSummary()`
- `getPaymentAuditReport()`
- `getSpendingAllowance()`
- `getAuditLog()`

All async operations return `AgentResult<T>`:

```ts
type AgentResult<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
    suggestion?: string;
  };
  metadata?: {
    timestamp: number;
  };
};
```

## MCP integration

```ts
import { MCP_TOOLS } from '@fiber-pay/agent/mcp';

for (const tool of Object.values(MCP_TOOLS)) {
  // register with your MCP host runtime
  // mcpServer.registerTool(tool)
}
```

See `src/mcp-tools.ts` for complete tool names and JSON schemas.

## Compatibility

- Node.js: `>=20`
- Fiber RPC semantics: aligned with Fiber `v0.7.1`

## Known gaps

- No dedicated `@fiber-pay/agent` test suite yet
- MCP runtime execution adapter is not bundled in this package
