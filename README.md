# fiber-pay

AI Agent Payment SDK for CKB Lightning Network (Fiber Network)

**Give AI agents the ability to own and manage money autonomously—no bank account required.**

## Overview

fiber-pay is a TypeScript SDK that wraps the [Fiber Network Node](https://github.com/nervosnetwork/fiber) binary, enabling AI agents to:

- **Own funds**: Generate and control private keys autonomously
- **Send payments**: Pay invoices or send directly to other nodes
- **Receive payments**: Create invoices and track incoming payments  
- **Manage channels**: Open and close Lightning channels
- **Verify invoices**: Cryptographic validation before payment
- **Track payments**: Payment proof system for audit trail
- **Manage liquidity**: Channel health analysis and rebalancing recommendations
- **Stay secure**: Built-in spending limits, rate limiting, and audit logging

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agent                                │
│                         ↓                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              FiberPay (Agent Interface)              │    │
│  │   • pay() / createInvoice() / getBalance()          │    │
│  │   • validateInvoice() / analyzeLiquidity()          │    │
│  │   • Returns AgentResult<T> format for LLM parsing   │    │
│  └─────────────────────────────────────────────────────┘    │
│                         ↓                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │PolicyEngine  │  │  KeyManager  │  │ InvoiceVerifier │   │
│  │• Spending    │  │• Keys        │  │• Cryptographic  │   │
│  │• Rate limits │  │• Encryption  │  │  validation     │   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
│                         ↓                                    │
│  ┌──────────────────┐  ┌─────────────────────────────┐     │
│  │ PaymentProofMgr  │  │   LiquidityAnalyzer         │     │
│  │• Proof tracking  │  │• Channel health scoring     │     │
│  │• Audit reports   │  │• Rebalancing recommendations│     │
│  └──────────────────┘  └─────────────────────────────┘     │
│                         ↓                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              FiberRpcClient                          │    │
│  │   • Type-safe JSON-RPC calls to fnn node            │    │
│  │   • All Fiber Network API methods                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                         ↓                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              ProcessManager                          │    │
│  │   • Starts/stops the fnn binary                     │    │
│  │   • Generates YAML config                           │    │
│  │   • Health monitoring                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                         ↓                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              BinaryManager                           │    │
│  │   • Auto-downloads fnn from GitHub releases         │    │
│  │   • Platform detection (macOS/Linux/Windows)        │    │
│  │   • Rosetta 2 fallback for Apple Silicon            │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                         ↓
              ┌──────────────────┐
              │   fnn binary     │
              │  (Fiber Node)    │
              │  JSON-RPC :8227  │
              │  P2P      :8228  │
              └──────────────────┘
                         ↓
              ┌──────────────────┐
              │  CKB Blockchain  │
              │    (Nervos)      │
              └──────────────────┘
```

## Installation

```bash
# Install the SDK
pnpm add fiber-pay

# Or with npm
npm install fiber-pay
```

### Binary Installation

The Fiber Network Node binary is **automatically downloaded** when needed. You can also manually download it:

```bash
# Using the CLI
npx fiber-pay download

# Download specific version
npx fiber-pay download --version v0.6.0

# Check binary status
npx fiber-pay binary-info
```

Or programmatically:

```typescript
import { downloadFiberBinary, ensureFiberBinary } from 'fiber-pay';

// Download explicitly
await downloadFiberBinary({
  version: 'latest',  // or 'v0.6.0'
  onProgress: (p) => console.log(p.message),
});

// Or let it auto-download when needed
const binaryPath = await ensureFiberBinary();
```

The binary will be installed to `~/.fiber-pay/bin/fnn` by default.

**Supported platforms:**
- macOS x64 and ARM64 (Apple Silicon via Rosetta 2)
- Linux x64
- Windows x64

## Quick Start

```typescript
import { createFiberPay } from 'fiber-pay';

// Create instance (binary auto-downloads if not found)
const fiber = createFiberPay({
  dataDir: '~/.fiber-pay',
  network: 'testnet',
});

// Initialize (starts the node, generates keys if needed)
await fiber.initialize();

// Check balance
const balance = await fiber.getBalance();
console.log(`Available: ${balance.data?.availableCkb} CKB`);

// Pay an invoice
const payment = await fiber.pay({
  invoice: 'fibt1qp...',
});

// Create invoice to receive payment
const invoice = await fiber.createInvoice({
  amountCkb: 10,
  description: 'Payment for AI services',
});
console.log(`Share this invoice: ${invoice.data?.invoice}`);

// Shutdown when done
await fiber.shutdown();
```

## CLI Usage

### Node Lifecycle

The recommended way to use the CLI is to start the node once and run commands against it:

```bash
# Terminal 1: Start node (runs in foreground)
fiber-pay start

# Terminal 2: Run commands against the running node
fiber-pay status    # Check if node is running
fiber-pay info      # Get node information
fiber-pay balance   # Get current balance
fiber-pay channels  # List channels
fiber-pay peers     # List connected peers

# Stop the node
fiber-pay stop
```

### Binary Management

```bash
# Download binary (auto-detects platform)
fiber-pay download
fiber-pay download --version v0.6.0  # Specific version
fiber-pay download --force           # Re-download

# Check binary status
fiber-pay binary-info
```

### Payments & Invoices

```bash
# Pay an invoice
fiber-pay pay fibt1qp...
fiber-pay pay --invoice <invoice>
fiber-pay pay --to <nodeId> --amount 10

# Create invoice for 10 CKB
fiber-pay invoice 10 --description "For services"
```

### Channel Management

```bash
# Open a channel with 100 CKB
fiber-pay open-channel --peer /ip4/x.x.x.x/tcp/8228/p2p/QmXXX --funding 100

# Close a channel
fiber-pay close-channel <channelId>
fiber-pay close-channel <channelId> --force
```

### Other Commands

```bash
# View audit log
fiber-pay audit --limit 20

# Get spending allowance
fiber-pay allowance

# Get help
fiber-pay help
```

### Command Categories

| Category | Commands | Behavior |
|----------|----------|----------|
| **Node Management** | `start`, `stop`, `status` | Control node lifecycle |
| **RPC Operations** | `info`, `balance`, `channels`, `peers`, `pay`, `invoice`, `open-channel`, `close-channel` | Connect to running node via RPC |
| **Standalone** | `download`, `binary-info`, `allowance`, `audit` | No running node required |

## MCP Integration

fiber-pay provides MCP (Model Context Protocol) tool definitions for direct integration with Claude, OpenClaw, and other compatible agents:

```typescript
import { MCP_TOOLS } from 'fiber-pay';

// Register tools with your MCP server
for (const tool of Object.values(MCP_TOOLS)) {
  mcpServer.registerTool(tool);
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `fiber_pay` | Pay invoice or send directly |
| `fiber_create_invoice` | Create invoice to receive payment |
| `fiber_get_balance` | Get current balance |
| `fiber_get_payment_status` | Check payment status |
| `fiber_get_invoice_status` | Check invoice status |
| `fiber_list_channels` | List all channels |
| `fiber_open_channel` | Open new channel |
| `fiber_close_channel` | Close channel |
| `fiber_get_node_info` | Get node information |
| `fiber_get_spending_allowance` | Get remaining spending allowance |
| `fiber_download_binary` | Download fnn binary |

## Security

### AI-Agent Friendly Response Format

All methods return `AgentResult<T>` - a structured format optimized for LLM parsing:

```typescript
interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  suggestion?: string;  // Hints for the AI on what to do next
}
```

### Spending Limits (PolicyEngine)

The SDK enforces spending limits that **cannot be bypassed via prompts**:

```typescript
const fiber = createFiberPay({
  policy: {
    maxPerTransaction: 100,      // Max 100 CKB per payment
    maxPerWindow: 1000,          // Max 1000 CKB per hour
    windowDurationMs: 3600000,   // 1 hour window
    allowedRecipients: [...],    // Optional whitelist
    blockedRecipients: [...],    // Optional blacklist
  }
});
```

### Key Management

- Keys are encrypted at rest by the Fiber node using `FIBER_SECRET_KEY_PASSWORD`
- The SDK generates raw keys in the expected format on first run:
  - `fiber/sk`: raw 32 bytes for P2P identity
  - `ckb/key`: hex-encoded 32 bytes for CKB wallet
- The fiber node automatically encrypts these on first startup
- Keys are **never exposed** to LLM context
- Set custom password via `FIBER_KEY_PASSWORD` environment variable (defaults to internal password)

### Audit Logging

All operations are logged for accountability:

```typescript
const log = fiber.getAuditLog({ limit: 100 });
// Returns: timestamp, action, success, details, policy violations
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FIBER_BINARY_PATH` | Path to fnn binary | Auto-downloads to `~/.fiber-pay/bin/fnn` |
| `FIBER_DATA_DIR` | Data directory | `~/.fiber-pay` |
| `FIBER_NETWORK` | Network (testnet/mainnet) | `testnet` |
| `FIBER_KEY_PASSWORD` | Key encryption password (passed to node as `FIBER_SECRET_KEY_PASSWORD`) | `fiber-pay-default-key` |
| `FIBER_RPC_URL` | Fiber node RPC URL | `http://127.0.0.1:8227` |

### Programmatic Configuration

```typescript
const fiber = createFiberPay({
  binaryPath: '/path/to/fnn',     // Optional - auto-downloads if not set
  dataDir: '/path/to/data',
  network: 'testnet',
  ckbRpcUrl: 'https://testnet.ckbapp.dev/',
  rpcPort: 8227,
  p2pPort: 8228,
  keyPassword: process.env.KEY_PASSWORD,
  bootnodes: ['/ip4/54.179.226.154/tcp/8228/p2p/Qmes...'],
  autoStart: true,
  policy: { /* ... */ },
});
```

## API Reference

### FiberPay Class

#### Lifecycle
- `initialize()` - Start node and connect (auto-downloads binary if needed)
- `shutdown()` - Stop node gracefully

#### Payments
- `pay({ invoice?, recipientNodeId?, amountCkb?, maxFeeCkb? })` - Send payment
- `createInvoice({ amountCkb, description?, expiryMinutes? })` - Create invoice
- `getPaymentStatus(paymentHash)` - Check payment status
- `getInvoiceStatus(paymentHash)` - Check invoice status

#### Balance & Info
- `getBalance()` - Get balance information
- `getNodeInfo()` - Get node information
- `getSpendingAllowance()` - Get remaining spending limits

#### Channels
- `listChannels()` - List all channels
- `openChannel({ peer, fundingCkb, isPublic? })` - Open channel
- `closeChannel({ channelId, force? })` - Close channel

#### Audit
- `getAuditLog({ limit?, since? })` - Get audit log entries

## Project Structure

```
fiber-pay/
├── src/
│   ├── agent/           # AI-friendly interface
│   │   ├── fiber-pay.ts # Main FiberPay class
│   │   └── mcp-tools.ts # MCP tool definitions
│   ├── binary/          # Binary download manager
│   │   └── manager.ts   # BinaryManager class
│   ├── process/         # fnn process lifecycle
│   │   ├── manager.ts   # ProcessManager class
│   │   └── yaml.ts      # Config file generation
│   ├── rpc/             # JSON-RPC client
│   │   └── client.ts    # FiberRpcClient class
│   ├── security/        # Security components
│   │   ├── policy-engine.ts  # Spending limits
│   │   └── key-manager.ts    # Key encryption
│   ├── types/           # TypeScript type definitions
│   │   ├── rpc.ts       # RPC types
│   │   └── policy.ts    # Policy schemas
│   ├── cli.ts           # Command-line interface
│   └── index.ts         # Public exports
├── tests/               # Unit tests
├── dist/                # Built output
└── package.json
```

## Testnet Verification

This SDK has been tested on CKB testnet with real funds:

- ✅ Binary download and node startup
- ✅ Key generation and wallet funding (10,000 CKB)
- ✅ Channel opening with testnet bootnode (200 CKB)
- ✅ Channel reaching `CHANNEL_READY` state with ~101 CKB available balance
- ✅ Channel closing and funds returned on-chain (~9,800 CKB after fees)

**Testnet Bootnode:**
```
/ip4/54.179.226.154/tcp/8228/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy
```

## Development

### Prerequisites

- Node.js >= 18
- pnpm (recommended) or npm

### Setup

```bash
# Clone the repository
git clone https://github.com/nervosnetwork/fiber-pay.git
cd fiber-pay

# Install dependencies
pnpm install

# Build the project
pnpm build

# Run tests
pnpm test
```

### Local CLI Testing

To test the CLI locally without publishing to npm, you can pack and install the package globally:

```bash
# Build and pack the project
pnpm build && pnpm pack

# Install globally from the tarball (use absolute path)
pnpm install -g /path/to/fiber-pay/fiber-pay-0.1.0.tgz

# Now you can use the CLI globally
fiber-pay --help
fiber-pay download
fiber-pay start
```

**Alternative: Using `pnpm link`** (recommended for active development)

```bash
# Create a global symlink to your local project
pnpm link --global

# Now fiber-pay CLI uses your local dist/ directly
# Changes are reflected immediately after running `pnpm build`
fiber-pay --help
```

To unlink when done:

```bash
pnpm unlink --global
```

### Development Workflow

```bash
# Watch mode - rebuilds on file changes
pnpm dev

# Type checking
pnpm typecheck

# Run specific test file
pnpm test policy-engine
```

## Agent Skills Integration

fiber-pay includes an [Agent Skills](https://agentskills.io) integration that enables AI agents to easily discover and use Lightning Network payment capabilities.

### What are Agent Skills?

Agent Skills is an open standard for packaging specialized knowledge and workflows that AI agents can discover and use on demand. The skill uses **progressive disclosure** to load context efficiently:
1. Agents first see a brief description to determine relevance
2. When activated, they load the full skill guide with examples and commands
3. Detailed references are loaded only when needed

### Using the fiber-pay Skill

The skill is located in [`skills/fiber-pay/`](skills/fiber-pay/):

```bash
# Agents can read the skill definition
cat skills/fiber-pay/SKILL.md

# Or use the CLI directly
fiber-pay --help
```

#### Skill Contents

- **[SKILL.md](skills/fiber-pay/SKILL.md)** - Main skill guide with setup instructions, core operations, and common workflows
- **[references/API.md](skills/fiber-pay/references/API.md)** - Complete API reference with all 11 MCP tools
- **[references/SECURITY.md](skills/fiber-pay/references/SECURITY.md)** - Security policy engine documentation
- **[references/TROUBLESHOOTING.md](skills/fiber-pay/references/TROUBLESHOOTING.md)** - Common errors and solutions
- **[assets/policy-example.json](skills/fiber-pay/assets/policy-example.json)** - Sample security policy configuration
- **[assets/config-example.yml](skills/fiber-pay/assets/config-example.yml)** - Node configuration template

#### Quick Start for Agents

1. **Installation**: Clone repo, run `pnpm install && pnpm build && pnpm link --global`
2. **Binary Setup**: `fiber-pay download`
3. **Start Node**: `fiber-pay start`
4. **Check Balance**: `fiber-pay balance`
5. **Send Payment**: `fiber-pay pay <invoice>`
6. **Create Invoice**: `fiber-pay invoice create --amount 10 --description "Payment"`

All commands return JSON in `AgentResult<T>` format for easy parsing.

#### Supported Agent Platforms

The fiber-pay skill is compatible with:
- Claude Desktop (filesystem-based agents)
- Goose, Roo Code, OpenCode (via bash commands)
- Any agent supporting the Agent Skills standard

See [skills/fiber-pay/SKILL.md](skills/fiber-pay/SKILL.md) for complete documentation.

#### Validating the Skill

The skill follows the [Agent Skills specification](https://agentskills.io). You can manually verify:

1. **Frontmatter**: SKILL.md has required `name` and `description` fields
2. **Name format**: lowercase, alphanumeric with hyphens, matches directory name
3. **Description**: Contains keywords for agent task matching
4. **File size**: SKILL.md is under 5000 tokens for efficient context loading

## Project Roadmap

### Phase 1: Base Tool ✅ (Current)
- ✅ Process management for fnn binary
- ✅ Auto binary download for all platforms
- ✅ Type-safe RPC client
- ✅ AI-friendly interface with AgentResult
- ✅ Security policy engine
- ✅ Key management with encryption
- ✅ CLI tool
- ✅ MCP tool definitions
- ✅ Testnet verification (channel open/close flow)
- ✅ Agent Skills integration

### Phase 2: Agent Skills
- [ ] MCP server implementation
- [ ] Claude Desktop integration example
- [ ] Multi-agent coordination patterns
- [ ] Payment request/approval workflows

### Phase 3: Advanced Features
- [ ] HD wallet support
- [ ] Multi-currency (UDT) support
- [ ] Cross-chain payments (BTC via CCH)
- [ ] Payment streaming
- [ ] Recurring payments
- [ ] Escrow contracts

### Phase 4: Production Hardening
- [ ] Mainnet support
- [ ] Hardware security module integration
- [ ] Distributed key management
- [ ] Anomaly detection
- [ ] Multi-sig requirements for large payments

## Contributing

Contributions welcome! Please read our contributing guidelines first.

## License

MIT

## Acknowledgments

- [Nervos Network](https://www.nervos.org/) for CKB and Fiber Network
- [Fiber Network](https://github.com/nervosnetwork/fiber) team for the node implementation
