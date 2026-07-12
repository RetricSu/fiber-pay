# @fiber-pay/react

React hooks and components for browser payment flows on Fiber.

## Install

```bash
pnpm add @fiber-pay/react @nervosnetwork/fiber-js react
# optional, for QR codes in NodeInfoPanel
pnpm add qrcode.react
```

`@nervosnetwork/fiber-js` is a peer dependency used by the browser WASM runtime.
If you provide a custom `wasmFactory`, you can manage that dependency yourself.

## Browser Requirements (WASM + Passkey)

For multithreaded WASM runtime (`SharedArrayBuffer`) in modern browsers, serve your app with:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Without these headers, Fiber WASM startup may fail with browser/runtime errors.

Vite example:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function crossOriginIsolation(): Plugin {
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((_req: IncomingMessage, res: ServerResponse, next: () => void) => {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), crossOriginIsolation()],
});
```

Note: `configureServer` only applies to Vite dev server. For production builds,
set these headers on your web server or CDN (for example Nginx, Cloudflare, Vercel).

## Bundle Size Notes

Browser Fiber WASM artifacts are large by nature. With `fiber-js` 0.9.0-rc4, the current
`react-fiber-node-button-lab` production build includes an additional ~45.5 MB JS chunk
(~13.4 MB gzip) for WASM/runtime assets.

Recommended integration strategy:

- Lazy-mount payment-heavy UI (for example route-level split).
- Keep WASM-dependent flows behind user intent (open panel, start node, pay flow).
- Accept a separate large chunk for WASM and tune warnings with `build.chunkSizeWarningLimit` when needed.
- Document expected bundle budgets in your downstream app so this chunk is intentional, not surprising.

## One-line import

```tsx
import { ConnectButton, FiberNodeButton, FiberPayQuickCard, NodeInfoPanel, useFiberNode, useFiberPayment } from '@fiber-pay/react';
```

## Quick start

```tsx
import { FiberPayQuickCard } from '@fiber-pay/react';

export function App() {
  return <FiberPayQuickCard network="testnet" />;
}
```

For a complete browser passkey + payment walkthrough, see [docs/wasm-passkey-payment-component-quickstart.md](./docs/wasm-passkey-payment-component-quickstart.md).

## Component customization

`FiberPayQuickCard` supports lightweight integration hooks:

- `fiber` (reuse existing `useFiberNode()` session)
- `asset`, `invoiceAmount` (CKB or whitelisted UDT payment context)
- `className`, `style`, `title`
- `onInvoiceCreated(invoice)`
- `onPaymentResult(result)`
- `onError({ scope, message })`

When you already manage connection state (for example with `ConnectButton`), pass the same hook result into `FiberPayQuickCard` so invoices and payments run on the same node session:

```tsx
import { ConnectButton, FiberPayQuickCard, useFiberNode } from '@fiber-pay/react';

export function UnifiedFlow() {
  const fiber = useFiberNode({ network: 'testnet', walletId: 'demo-wallet' });

  return (
    <>
      <ConnectButton fiber={fiber} strategy="passkey" />
      <FiberPayQuickCard fiber={fiber} network="testnet" title="Quick Card" />
    </>
  );
}
```

## ConnectButton

Use `ConnectButton` with an existing `useFiberNode` result for drop-in integration.

```tsx
import { ConnectButton, useFiberNode } from '@fiber-pay/react';
import { Fiber } from '@nervosnetwork/fiber-js';

export function HeaderWallet() {
  const fiber = useFiberNode({ network: 'testnet', wasmFactory: () => new Fiber() });
  return <ConnectButton fiber={fiber} strategy="passkey" />;
}
```

## NodeInfoPanel

`NodeInfoPanel` is a **display-only** component that shows Fiber browser node metadata, real-time stats, and an optional QR code for deposits. It is the complement to `ConnectButton`/`FiberNodeButton` — while those handle connection management and operations, `NodeInfoPanel` provides the dashboard view.

```tsx
import { NodeInfoPanel, useFiberNode } from '@fiber-pay/react';

export function NodeDashboard() {
  const fiber = useFiberNode({ network: 'testnet', walletId: 'dashboard' });

  return (
    <NodeInfoPanel node={fiber.node} network="testnet" showQrCode />
  );
}
```

> **Note:** `NodeInfoPanel` does **not** manage the node lifecycle. It expects a running `FiberBrowserNode` instance passed via the `node` prop — use `useFiberNode` or `ConnectButton`/`FiberNodeButton` for connection management.

### What it shows

| Info | Detail |
|------|--------|
| **Node state badge** | Visual status indicator (idle, starting, running, error, etc.) |
| **Pubkey** | Full display with **copy-to-clipboard button** |
| **Funding Address** | Derived from the node's lock script, displayed with **copy button** |
| **Peers / Channels count** | Compact stat cards |
| **CKB / UDT Balance** | Queried from chain via RPC for the selected `asset` (updated every 15s) |
| **QR Code** | Optional — encodes the funding address only (`showQrCode` prop). For UDT deposits, the wallet must still select the matching token script. |

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `node` | `FiberBrowserNode \| null` | — | The running node instance. Pass `null` for idle state. |
| `network` | `"testnet" \| "mainnet"` | — | Network for address derivation and RPC URL. |
| `asset` | `UdtAsset` | `{ kind: "ckb" }` | Balance asset. UDT values are displayed in raw base units. |
| `pollInterval` | `number` | `15000` | Stats refresh interval in milliseconds. |
| `showQrCode` | `boolean` | `false` | Show a QR code of the CKB address (requires `qrcode.react`). |
| `renderQrCode` | `(value: string) => ReactNode` | — | Override QR rendering with your own library. |
| `className` | `string` | — | Additional CSS class name(s). |
| `style` | `CSSProperties` | — | Inline styles. |

### Role comparison

| Capability | ConnectButton | FiberNodeButton | NodeInfoPanel |
|------------|:---:|:---:|:---:|
| Connect / Disconnect | ✅ | ✅ | ❌ |
| Create invoices / Pay | ❌ | ✅ | ❌ |
| Channel management | ❌ | ✅ | ❌ |
| Diagnostics (graph/peers) | ❌ | ✅ | ❌ |
| **Pubkey with copy** | ❌ | ❌ | ✅ |
| **CKB Address + copy** | ❌ | ❌ | ✅ |
| **QR code for deposit** | ❌ | ❌ | ✅ |
| **CKB balance** | ❌ | ❌ | ✅ |

### Combining with other components

`NodeInfoPanel` is designed to compose with `ConnectButton` and `FiberNodeButton` through the shared `useFiberNode` hook:

**Standalone layout** — ConnectButton in the header, NodeInfoPanel in a sidebar:
```tsx
import { ConnectButton, NodeInfoPanel, useFiberNode } from '@fiber-pay/react';

export function WalletLayout() {
  const fiber = useFiberNode({ network: 'testnet', walletId: 'main-wallet' });

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <header>
        <ConnectButton fiber={fiber} strategy="passkey" />
      </header>
      <aside>
        <NodeInfoPanel node={fiber.node} network="testnet" showQrCode />
      </aside>
    </div>
  );
}
```

**As a custom tab in FiberNodeButton** — add a "Deposit" tab inside the existing dropdown (see [Tab customization](#tab-customization) below for more options):

```tsx
import { FiberNodeButton, NodeInfoPanel, useFiberNode } from '@fiber-pay/react';

export function WalletWithDeposit() {
  const fiber = useFiberNode({ network: 'testnet', walletId: 'wallet-deposit' });

  return (
    <FiberNodeButton
      fiber={fiber}
      strategy="passkey"
      tabs={[
        { id: 'workbench' },
        { id: 'channels' },
        {
          id: 'deposit',
          label: 'Deposit',
          render: ({ fiber: { node }, asset }) => (
            <NodeInfoPanel node={node} network="testnet" asset={asset} showQrCode />
          ),
        },
        { id: 'diagnostics' },
      ]}
    />
  );
}
```

## FiberNodeButton

`FiberNodeButton` is a higher-level button + dropdown panel for day-to-day node operations.
It wraps `ConnectButton` and provides default sections for:

- Connection state and disconnect
- Channel management (peer connect / open channel)
- Payment management (create invoice / pay invoice)
- Optional connector section (custom renderer)

```tsx
import { FiberNodeButton, useFiberNode } from '@fiber-pay/react';

export function WalletEntry() {
  const fiber = useFiberNode({ network: 'testnet', walletId: 'demo-wallet' });

  return (
    <FiberNodeButton
      fiber={fiber}
      strategy="passkey"
      onLog={(message) => console.log(message)}
    />
  );
}
```

### What it does

`FiberNodeButton` gives you a complete wallet UI in a single component:

1. **Connect / Disconnect** — Handles passkey or password authentication via `ConnectButton`
2. **Workbench tab** — Create invoices, pay invoices, and see node info at a glance
3. **Channels tab** — List active channels, connect to peers, and open new channels
4. **Diagnostics tab** — Inspect node state, peer list, and passkey support status
5. **External funding** — Optionally delegate CKB funding to an external wallet (e.g. CCC)

```
┌─────────────────────────────────────────┐
│  [🔵 abc123…e789 ▼]  ← ConnectButton   │
├─────────────────────────────────────────┤
│  ┌──────────┬──────────┬────────────┐  │
│  │ Workbench│ Channels │ Diagnostics│  │
│  ├──────────┴──────────┴────────────┤  │
│  │  • Create Invoice                │  │
│  │  • Pay Invoice                   │  │
│  │  • Node Info                     │  │
│  │                                  │  │
│  │  [Disconnect]                    │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `network` | `"testnet" \| "mainnet"` | `fiber.network`, then `"testnet"` | Network used for node startup and invoice currency. |
| `fiber` | `UseFiberNodeResult` | — | Pre-existing hook result. When provided, the button shares this session instead of creating its own. |
| `strategy` | `"passkey" \| "password"` | `"passkey"` | Credential strategy for authentication. |
| `externalWallet` | `boolean` | `false` | Enable external wallet mode (no internal CKB key derivation). |
| `password` | `string` | — | Password for the `"password"` strategy. |
| `walletId` | `string` | — | Wallet identifier for IndexedDB isolation. |
| `passkeyUsername` | `string` | `"User"` | Display name for passkey registration. |
| `wasmFactory` | `FiberWasmFactory` | — | Optional WASM factory override. |
| `nodeConfig` | `UseFiberNodeOptions["nodeConfig"]` | — | Additional node configuration. |
| `asset` | `UdtAsset` | `{ kind: "ckb" }` | Asset used for channel funding, invoices, and payments. |
| `className` | `string` | — | Additional CSS class for the root container. |
| `style` | `CSSProperties` | — | Inline styles for the root container. |
| `dropdownStyle` | `CSSProperties` | — | Inline styles for the dropdown panel. |
| `onConnect` | `(node, nodeInfo) => void` | — | Called when the node reaches the `"running"` state. |
| `onDisconnect` | `() => void` | — | Called after the node is stopped. |
| `onError` | `(error: string) => void` | — | Called when an error occurs. |
| `onLog` | `(message: string) => void` | — | Called with informational log messages. |
| `initialPeerPubkey` | `string` | `""` | Pre-filled peer pubkey for the open-channel form. |
| `initialPeerAddress` | `string` | `""` | Pre-filled peer address for the open-channel form. |
| `initialFundingAmountCkb` | `string` | `"1000"` | Pre-filled funding amount (in CKB) for the open-channel form. |
| `initialFundingAmount` | `string` | — | CKB display amount or raw integer UDT base units. Takes precedence over `initialFundingAmountCkb`. |
| `invoiceAmount` | `string` | `"1"` | CKB display amount or raw integer UDT base units. |
| `externalFunding` | `FiberNodeButtonExternalFundingConfig` | — | External funding resolver configuration. |
| `renderConnectorSection` | `(context) => ReactNode` | — | Custom renderer for the connector section inside the panel. |
| `tabs` | `FiberNodeButtonTabConfig[]` | — | Reorder, hide, or extend built-in tabs. |
| `renderTabContent` | `(tabId, context) => ReactNode \| undefined` | — | Override tab body rendering per tab. Return `undefined` to fall through. |
| `renderAction` | `(context) => ReactNode \| undefined` | — | Replace default action buttons (e.g. Pay Invoice, Open Channel). |
| `t` | `FiberNodeButtonI18n` | — | Localization function for labels and copy. |

### UDT setup

Passing `asset` selects the token for UI and RPC calls, but it does **not** configure the Fiber node. The same type script must be present in `nodeConfig.udtWhitelist`, including the token's official cell deps. Both channel peers must support the token.

UDT amounts are raw integer base units. For a token with 8 decimals, `100000000` represents one display token.

```tsx
import { FiberNodeButton, useFiberNode, type UdtAsset } from '@fiber-pay/react';

const RUSD_SCRIPT = {
  code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
  hash_type: 'type' as const,
  args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
};

const RUSD: UdtAsset = { kind: 'udt', name: 'RUSD', script: RUSD_SCRIPT };

export function RusdWallet() {
  const fiber = useFiberNode({
    network: 'testnet',
    walletId: 'rusd-wallet',
    nodeConfig: {
      udtWhitelist: [
        {
          name: 'RUSD',
          script: RUSD_SCRIPT,
          cellDeps: [
            {
              typeId: {
                code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
                hash_type: 'type',
                args: '0x97d30b723c0b2c66e9cb8d4d0df4ab5d7222cbb00d4a9a2055ce2e5d7f0d8b0f',
              },
            },
          ],
          autoAcceptAmount: '1000000000',
        },
      ],
    },
  });

  return (
    <FiberNodeButton
      fiber={fiber}
      asset={RUSD}
      initialFundingAmount="1000000000"
      invoiceAmount="100000000"
      onError={console.error}
    />
  );
}
```

`FiberNodeButton` verifies that the configured UDT appears in `nodeInfo.udt_cfg_infos`, checks pasted invoice network and serialized UDT script before payment, and rejects mismatches before `send_payment`.

### State mapping

`FiberNodeButton` delegates connection state to `ConnectButton`. The UI updates automatically as the underlying node state changes:

| Node State | Button Label | Panel |
|-----------|--------------|-------|
| `idle` | "Connect with Passkey" / "Connect" (strategy-dependent) | Hidden |
| `unlocking` / `starting` | "Connecting…" (spinner) | Hidden |
| `running` | Truncated pubkey + ▼ | Visible |
| `error` | Error message shown | Hidden |

### Tab customization

`FiberNodeButton` now supports additive panel customization without forking the component:

- `tabs`: reorder / hide built-in tabs and add custom tabs
- `renderTabContent(tabId, context)`: override tab body rendering
- `renderAction(context)`: replace default action button UI/behavior for selected actions (context includes `state`)
- `t(key, fallback, vars?)`: localize labels and copy

> **Tip:** Use a custom tab to embed `NodeInfoPanel` (see [its section](#nodeinfopanel) above) for a deposit/recharge UI inside `FiberNodeButton`'s dropdown — no extra layout needed.

Render precedence for a tab body is:
1. `renderTabContent(tabId, context)` when it returns a value other than `undefined`
2. `tabs[i].render(context)` for the selected tab (including built-in tab ids)
3. built-in tab body (`Workbench`, `Channels`, `Diagnostics`)

`renderTabContent` semantics:
- return `undefined` to fall back to the next renderer
- return `null` to intentionally render an empty tab body

```tsx
import { FiberNodeButton, useFiberNode } from '@fiber-pay/react';

export function CustomPanelDemo() {
  const fiber = useFiberNode({ network: 'testnet', walletId: 'custom-panel-demo' });

  return (
    <FiberNodeButton
      fiber={fiber}
      strategy="passkey"
      tabs={[
        { id: 'workbench' },
        {
          id: 'my-stats',
          label: 'My Stats',
          render: ({ state }) => <div>Peers: {state.connectedPeers.length}</div>,
        },
        { id: 'channels' },
        { id: 'diagnostics', hidden: true },
      ]}
      renderAction={({ id, defaultProps }) => {
        if (id !== 'pay-invoice') {
          return undefined;
        }

        return (
          <button
            type="button"
            disabled={defaultProps.disabled}
            onClick={() => {
              void defaultProps.onTrigger();
            }}
          >
            {defaultProps.loading ? 'Paying...' : 'Pay Now'}
          </button>
        );
      }}
      t={(key, fallback) => {
        const zh: Record<string, string> = {
          'tabs.workbench': '操作台',
          'tabs.channels': '通道',
          'actions.payInvoice': '立即支付',
        };

        return zh[key] ?? fallback;
      }}
    />
  );
}
```

#### Built-in tab IDs

| Tab ID | Default Label | Can Hide |
|--------|---------------|----------|
| `workbench` | "Workbench" | Yes |
| `channels` | "Channels" | Yes |
| `diagnostics` | "Diagnostics" | Yes |

#### Action IDs for `renderAction`

| Action ID | Default Label | Context |
|-----------|---------------|---------|
| `open-channel` | "Open Channel" | Form state is accessible via `state` |
| `create-invoice` | "Create Invoice" | — |
| `pay-invoice` | "Pay Invoice" | — |
| `close-channel` | "Close Channel" | Includes `channelId` |
| `force-close-channel` | "Force Close" | Includes `channelId` |

### External funding

For external funding, pass `externalFunding` with an async `resolve` callback that returns
`signFundingTx` and optional script / dep overrides.

The resolver context includes `asset` and `fundingAmount`; for UDTs the amount is raw base units. The legacy `fundingAmountCkb` field remains for compatibility and should not be used for new integrations.

If you use CCC wallets, `@fiber-pay/sdk/browser` provides
`createCccExternalFundingResolver(...)` so you do not need to handwrite resolve logic:

```tsx
import { ccc } from '@ckb-ccc/connector-react';
import { createCccExternalFundingResolver } from '@fiber-pay/sdk/browser';

const resolveExternalFunding = createCccExternalFundingResolver({
  signer: cccSigner,
  knownScripts: Object.values(ccc.KnownScript),
  ckbRpcUrl: 'https://testnet.ckbapp.dev/',
});
```

Then pass it to `FiberNodeButton`:

```tsx
<FiberNodeButton
  fiber={fiber}
  strategy="passkey"
  externalFunding={{ enabled: true, resolve: resolveExternalFunding }}
/>
```

### Custom connected dropdown

`ConnectButton` uses explicit strategy selection and supports only `"passkey"` or `"password"`.

For custom connected-state panels (for example peer/channel controls), use `renderConnectedDropdown`:

```tsx
<ConnectButton
  fiber={fiber}
  strategy="passkey"
  dropdownStyle={{ width: 320 }}
  renderConnectedDropdown={({ fiber, disconnect }) => (
    <div>
      <div>State: {fiber.state}</div>
      <button
        type="button"
        onClick={() => {
          void disconnect();
        }}
      >
        Disconnect
      </button>
    </div>
  )}
/>
```

### Localization keys

The following common keys can be localized via the `t` prop (additional keys exist for metrics, meta, and dialogs):

| Key | Default | Used In |
|-----|---------|---------|
| `tabs.workbench` | "Workbench" | Tab label |
| `tabs.channels` | "Channels" | Tab label |
| `tabs.diagnostics` | "Diagnostics" | Tab label |
| `actions.openChannel` | "Open Channel" | Action button |
| `actions.createInvoice` | "Create Invoice" | Action button |
| `actions.payInvoice` | "Pay Invoice" | Action button |
| `actions.closeChannel` | "Close Channel" | Action button |
| `actions.forceCloseChannel` | "Force Close" | Action button |

## Hooks

- `useFiberNode(options)`
- `useFiberPayment(node, { asset?, network? })`

`useFiberNode` exposes passkey/password startup, node lifecycle methods, and passkey diagnostics (`passkeySupportReason`, `passkeyUnavailableReason`).

`useFiberPayment` supports both convenience and staged flows:

- `payInvoice(invoice)` (parse + send + wait in one call)
- `parseInvoice(invoice)`
- `sendPayment(invoice)`
- `waitForPayment(paymentHash)`

`payInvoice` parses and validates invoice network/asset before sending. The lower-level staged `sendPayment` API cannot validate an invoice by itself; staged callers should inspect the `parseInvoice` result before calling it.

Staged flow example:

```tsx
const { parseInvoice, sendPayment, waitForPayment, error } = useFiberPayment(node);

const confirmAndPay = async (invoice: string) => {
  const parsed = await parseInvoice(invoice);
  // Render your own confirmation UI before actually sending
  console.log('Will pay hash:', parsed.invoice.data.payment_hash);

  await sendPayment(invoice);
  const result = await waitForPayment(parsed.invoice.data.payment_hash);
  console.log('Payment status:', result.status);
};
```

## Error Recovery Pattern

If `useFiberNode` startup fails, `state` may enter `error` and `error` will contain the raw failure message.
You can retry with the same hook instance (no unmount/remount required):

```tsx
const { state, error, startWithPasskey, startWithPassword } = useFiberNode({
  network: 'testnet',
  walletId: 'demo-wallet',
});

const retry = async () => {
  if (state === 'error') {
    await startWithPasskey();
    // or: await startWithPassword('your-password');
  }
};
```

For production UIs, map `error` to actionable guidance (for example: COOP/COEP missing, invalid password,
passkey canceled, secure-context requirement).
