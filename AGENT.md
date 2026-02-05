# AGENT.md - AI Maintainer Guide

This document helps AI agents understand and maintain the fiber-pay codebase.

## Project Purpose

fiber-pay is a TypeScript SDK that enables AI agents to autonomously manage Lightning Network payments on the CKB (Nervos) blockchain. It wraps the Fiber Network Node (`fnn`) binary.

## Quick Context

- **Language**: TypeScript (ES2022, ESM modules)
- **Runtime**: Node.js 18+
- **Package Manager**: pnpm
- **Build Tool**: tsup
- **Test Framework**: vitest
- **Validation**: zod v4

## Directory Structure

```
src/
├── agent/              # AI-facing interface (START HERE for agent features)
│   ├── fiber-pay.ts    # Main FiberPay class - the primary API
│   ├── mcp-tools.ts    # MCP tool definitions for Claude/OpenClaw
│   └── index.ts
├── binary/             # Binary download management
│   ├── manager.ts      # BinaryManager - downloads fnn from GitHub
│   └── index.ts
├── process/            # Process lifecycle
│   ├── manager.ts      # ProcessManager - starts/stops fnn binary
│   ├── yaml.ts         # Config file generator
│   └── index.ts
├── rpc/                # JSON-RPC client
│   ├── client.ts       # FiberRpcClient - all RPC methods
│   └── index.ts
├── security/           # Security components
│   ├── policy-engine.ts # Spending limits, rate limiting
│   ├── key-manager.ts   # Key generation (fiber node handles encryption)
│   └── index.ts
├── verification/       # Payment verification systems
│   ├── invoice-verifier.ts  # Cryptographic invoice validation
│   ├── payment-proof.ts     # Payment proof tracking & audit
│   └── index.ts
├── funds/              # Fund management & liquidity
│   ├── liquidity-analyzer.ts # Channel health & rebalancing
│   └── index.ts
├── types/              # Type definitions
│   ├── rpc.ts          # All RPC request/response types
│   ├── policy.ts       # Policy schemas (zod)
│   └── index.ts
├── cli.ts              # Command-line interface
└── index.ts            # Public exports

skills/
└── fiber-pay/          # Agent Skills integration (agentskills.io)
    ├── SKILL.md        # Main skill definition for AI agents
    ├── references/     # Detailed documentation
    │   ├── API.md      # Complete API reference (11 MCP tools)
    │   ├── SECURITY.md # Policy engine documentation
    │   └── TROUBLESHOOTING.md
    └── assets/         # Configuration templates
        ├── policy-example.json
        └── config-example.yml
```

## Key Files to Understand

### 1. `src/agent/fiber-pay.ts` - Main Interface
The `FiberPay` class is the primary API. All methods return `AgentResult<T>`:

```typescript
interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  suggestion?: string;  // Hints for AI
}
```

**Key methods**: 
- Payment: `pay()`, `createInvoice()`, `getPaymentStatus()`, `getInvoiceStatus()`
- Balance: `getBalance()`, `canSend()`
- Channels: `listChannels()`, `openChannel()`, `closeChannel()`
- Verification: `validateInvoice()`, `getPaymentProof()`
- Liquidity: `analyzeLiquidity()`, `canSend()`

### 2. `src/rpc/client.ts` - RPC Client
Type-safe JSON-RPC client for all Fiber Network API methods. Uses hex encoding for amounts (shannons).

**Important**: 1 CKB = 100,000,000 shannons (10^8)

### 3. `src/security/policy-engine.ts` - Security Sandbox
Enforces spending limits outside LLM control. Cannot be bypassed via prompts.

### 4. `src/binary/manager.ts` - Binary Download
Auto-downloads `fnn` binary from GitHub releases. Handles platform detection and Rosetta 2 fallback.

### 5. `src/types/rpc.ts` - Type Definitions
All JSON-RPC types. Reference when adding new RPC methods.

### 6. `src/verification/invoice-verifier.ts` - Invoice Validation
Cryptographically validates invoices before payment. Checks format, expiry, amount, preimage, and peer connectivity. Returns detailed verification results with trust scores and recommendations.

### 7. `src/verification/payment-proof.ts` - Payment Proof Tracking
Records and stores payment proofs for audit trail. Validates preimage hashes, maintains payment history, and exports audit reports. Proofs stored in JSON at `<dataDir>/payment-proofs.json`.

### 8. `src/funds/liquidity-analyzer.ts` - Liquidity Management
Analyzes channel health, identifies liquidity gaps, generates rebalancing recommendations. Calculates health scores, detects imbalances, and estimates funding needs.

## Common Tasks

### Adding a New RPC Method

1. Add types to `src/types/rpc.ts`:
```typescript
export interface NewMethodParams { ... }
export interface NewMethodResult { ... }
```

2. Add method to `src/rpc/client.ts`:
```typescript
async newMethod(params: NewMethodParams): Promise<NewMethodResult> {
  return this.call('new_method', params);
}
```

3. Add wrapper to `src/agent/fiber-pay.ts`:
```typescript
async newMethod(params): Promise<AgentResult<T>> {
  // Add policy check if needed
  // Call RPC
  // Return AgentResult
}
```

4. Add MCP tool to `src/agent/mcp-tools.ts` if agent-facing.

### Adding a CLI Command

Edit `src/cli.ts`:

1. **For RPC commands** (info, balance, pay, invoice, channels, etc.):
   - Add to `handleRpcCommand()` function
   - Add command name to `rpcOnlyCommands` array in `main()`
   - These commands connect to a running node via RPC

2. **For standalone commands** (download, binary-info, etc.):
   - Add to `handleStandaloneCommand()` function
   - Add command name to `standaloneCommands` array in `main()`
   - These don't need a running node

3. **For node management commands** (start, stop, status):
   - Handle directly in `main()` function

4. Update `printHelp()` with the new command

**Note:** Most commands should go into `handleRpcCommand()` since the node
should be running separately via `fiber-pay start`.

### Modifying Security Policy

Edit `src/types/policy.ts` for schema changes.
Edit `src/security/policy-engine.ts` for enforcement logic.

## Testing

```bash
pnpm test        # Watch mode
pnpm test:run    # Single run
```

Tests are in `tests/` directory. Current tests:
- `policy-engine.test.ts` - Policy enforcement
- `rpc-utils.test.ts` - Utility functions

## Building

```bash
pnpm build       # Build to dist/
pnpm typecheck   # Type check only
```

Output:
- `dist/index.js` - Library entry
- `dist/cli.js` - CLI entry (has shebang)
- `dist/*.d.ts` - Type declarations

## Important Patterns

### Hex Encoding for Amounts
All amounts in RPC use hex-encoded shannons:
```typescript
import { ckbToShannons, toHex } from './rpc/index.js';
const hexAmount = toHex(ckbToShannons(10)); // "0x3b9aca00"
```

### Error Handling
Always return `AgentResult`:
```typescript
return {
  success: false,
  error: 'What went wrong',
  suggestion: 'What the AI should try next'
};
```

### Policy Checks
Before any spending operation:
```typescript
const check = this.policy.checkTransaction(amountShannons, recipient);
if (!check.allowed) {
  return { success: false, error: check.reason };
}
```

## External Dependencies

### Fiber Network Node (fnn)
- Binary from: https://github.com/nervosnetwork/fiber
- JSON-RPC API on port 8227
- P2P network on port 8228
- Config file: YAML format

### CKB Blockchain
- Testnet RPC: https://testnet.ckbapp.dev/
- Mainnet RPC: https://mainnet.ckbapp.dev/

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `FIBER_BINARY_PATH` | Override fnn binary location |
| `FIBER_DATA_DIR` | Data directory |
| `FIBER_NETWORK` | `testnet` or `mainnet` |
| `FIBER_RPC_URL` | Fiber node RPC URL (default: `http://127.0.0.1:8227`) |
| `FIBER_KEY_PASSWORD` | Key encryption password (passed to fiber node as `FIBER_SECRET_KEY_PASSWORD`) |

## Gotchas & Warnings

1. **zod v4 syntax**: Use `z.record(z.string(), z.unknown())` not `z.record(z.unknown())`

2. **ESM imports**: Always use `.js` extension in imports even for `.ts` files

3. **Key file formats**: The fiber node expects different formats for different keys:
   - `fiber/sk`: raw 32 bytes (binary)
   - `ckb/key`: hex-encoded 32 bytes (64 character string, no 0x prefix)
   
   The KeyManager generates these formats automatically. The fiber node requires `FIBER_SECRET_KEY_PASSWORD` env var and encrypts the keys on first startup.

4. **Async state**: After async operations, re-check state before accessing:
```typescript
// Bad: this.state might have changed
await someAsyncOp();
if (this.state === 'running') { ... }

// Good: cast explicitly if you know it's safe
if ((this.state as ProcessState) === 'running') { ... }
```

5. **Binary names vary**: GitHub release assets use patterns like `fnn_v0.6.1-x86_64-darwin-portable.tar.gz`, not consistent naming

6. **ARM64 macOS**: No native binary yet, uses x86_64 via Rosetta 2

## Testnet Verification

The SDK has been verified on CKB testnet:
- ✅ Binary download (fnn v0.6.1) 
- ✅ Node startup with proper key encryption
- ✅ Channel open with testnet bootnode (200 CKB)
- ✅ Channel ready state with available balance
- ✅ Channel close with funds returned on-chain

Testnet bootnode: `/ip4/54.179.226.154/tcp/8228/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy`

## Roadmap Items (Not Yet Implemented)

- MCP server (actual server, not just tool definitions)
- HD wallet / BIP39 mnemonics
- UDT (User Defined Token) support
- Cross-chain via CCH
- Multi-sig

## Agent Skills Integration

The project includes an [Agent Skills](https://agentskills.io) integration in `skills/fiber-pay/`.

### What is Agent Skills?

Agent Skills is an open standard for packaging knowledge and workflows that AI agents can discover and use on demand. It uses **progressive disclosure** for context efficiency.

### Skill Structure

```
skills/fiber-pay/
├── SKILL.md              # Main skill (agents read this first)
├── references/
│   ├── API.md            # Detailed API docs (loaded on demand)
│   ├── SECURITY.md       # Security policy details
│   └── TROUBLESHOOTING.md
└── assets/
    ├── policy-example.json
    └── config-example.yml
```

### Updating the Skill

When making changes to fiber-pay:

1. **New CLI commands**: Update `skills/fiber-pay/SKILL.md` with usage examples
2. **New MCP tools**: Update `skills/fiber-pay/references/API.md` with tool schema
3. **New error codes**: Update `skills/fiber-pay/references/TROUBLESHOOTING.md`
4. **Policy changes**: Update `skills/fiber-pay/references/SECURITY.md`

### Skill Validation Checklist

- [ ] `SKILL.md` has valid YAML frontmatter with `name` and `description`
- [ ] `name` field matches directory name (`fiber-pay`)
- [ ] `description` contains keywords for agent task matching
- [ ] SKILL.md is under ~500 lines (efficient context loading)
- [ ] All CLI examples are accurate and tested

## Local CLI Testing

To test the CLI locally without publishing to npm:

### Method 1: Pack and Install (recommended for testing releases)

```bash
# Build and pack the project
pnpm build && pnpm pack

# Install globally from tarball (use absolute path)
pnpm install -g /absolute/path/to/fiber-pay/fiber-pay-0.1.0.tgz

# Now use CLI globally
fiber-pay --help
fiber-pay download
fiber-pay start
```

### Method 2: pnpm link (recommended for active development)

```bash
# Create global symlink to local project
pnpm link --global

# CLI now uses local dist/ directly
# Changes reflected immediately after `pnpm build`
fiber-pay --help

# Unlink when done
pnpm unlink --global
```

### Method 3: Run directly from dist/

```bash
# Run CLI directly without global install
node dist/cli.js --help
node dist/cli.js download
node dist/cli.js start
```

## Useful Commands

```bash
# Start node (runs in foreground)
./dist/cli.js start

# In another terminal:
./dist/cli.js status      # Check if running
./dist/cli.js info        # Node info
./dist/cli.js balance     # Balance
./dist/cli.js channels    # List channels

# Stop node
./dist/cli.js stop

# Binary management
./dist/cli.js download
./dist/cli.js binary-info

# Test fnn directly
~/.fiber-pay/bin/fnn --version

# View all exports
grep "^export" src/index.ts
```

## Code Quality Checklist

Before committing changes:
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test:run` passes
- [ ] `pnpm build` succeeds
- [ ] New methods have proper TypeScript types
- [ ] New agent methods return `AgentResult<T>`
- [ ] Security-sensitive operations have policy checks
- [ ] CLI help is updated if adding commands
