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

Browser Fiber WASM artifacts are large by nature. In the current examples, a production build includes
an additional ~14 MB JS chunk (~6.5 MB gzip) for WASM/runtime assets.

Recommended integration strategy:

- Lazy-mount payment-heavy UI (for example route-level split).
- Keep WASM-dependent flows behind user intent (open panel, start node, pay flow).
- Accept a separate large chunk for WASM and tune warnings with `build.chunkSizeWarningLimit` when needed.
- Document expected bundle budgets in your downstream app so this chunk is intentional, not surprising.

## One-line import

```tsx
import { ConnectButton, FiberPayQuickCard, useFiberNode, useFiberPayment } from '@fiber-pay/react';
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
| `network` | `"testnet" \| "mainnet"` | `"testnet"` | Network to connect to. |
| `fiber` | `UseFiberNodeResult` | — | Pre-existing hook result. When provided, the button shares this session instead of creating its own. |
| `strategy` | `"passkey" \| "password"` | `"passkey"` | Credential strategy for authentication. |
| `externalWallet` | `boolean` | `false` | Enable external wallet mode (no internal CKB key derivation). |
| `password` | `string` | — | Password for the `"password"` strategy. |
| `walletId` | `string` | — | Wallet identifier for IndexedDB isolation. |
| `passkeyUsername` | `string` | `"User"` | Display name for passkey registration. |
| `wasmFactory` | `FiberWasmFactory` | — | Optional WASM factory override. |
| `nodeConfig` | `FiberBrowserNodeConfig["nodeConfig"]` | — | Additional node configuration. |
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
| `externalFunding` | `FiberNodeButtonExternalFundingConfig` | — | External funding resolver configuration. |
| `renderConnectorSection` | `(context) => ReactNode` | — | Custom renderer for the connector section inside the panel. |
| `tabs` | `FiberNodeButtonTabConfig[]` | — | Reorder, hide, or extend built-in tabs. |
| `renderTabContent` | `(tabId, context) => ReactNode \| undefined` | — | Override tab body rendering per tab. Return `undefined` to fall through. |
| `renderAction` | `(context) => ReactNode \| undefined` | — | Replace default action buttons (e.g. Pay Invoice, Open Channel). |
| `t` | `FiberNodeButtonI18n` | — | Localization function for labels and copy. |

### State mapping

`FiberNodeButton` delegates connection state to `ConnectButton`. The UI updates automatically as the underlying node state changes:

| Node State | Button Label | Panel |
|-----------|--------------|-------|
| `idle` | "Connect with Passkey" | Hidden |
| `unlocking` / `starting` | "Connecting…" (spinner) | Hidden |
| `running` | Truncated pubkey + ▼ | Visible |
| `error` | Error message shown | Hidden |

### Tab customization

`FiberNodeButton` now supports additive panel customization without forking the component:

- `tabs`: reorder / hide built-in tabs and add custom tabs
- `renderTabContent(tabId, context)`: override tab body rendering
- `renderAction(context)`: replace default action button UI/behavior for selected actions (context includes `state`)
- `t(key, fallback, vars?)`: localize labels and copy

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
| `open-channel` | "Open Channel" | Includes `initialPeerPubkey`, `initialPeerAddress`, `initialFundingAmountCkb` |
| `create-invoice` | "Create Invoice" | — |
| `pay-invoice` | "Pay Invoice" | — |
| `close-channel` | "Close Channel" | Includes `channelId` |
| `force-close-channel` | "Force Close" | Includes `channelId` |

### External funding

For external funding, pass `externalFunding` with an async `resolve` callback that returns
`signFundingTx` and optional script / dep overrides.

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

The following keys can be localized via the `t` prop:

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
- `useFiberPayment(node)`

`useFiberNode` exposes passkey/password startup, node lifecycle methods, and passkey diagnostics (`passkeySupportReason`, `passkeyUnavailableReason`).

`useFiberPayment` supports both convenience and staged flows:

- `payInvoice(invoice)` (parse + send + wait in one call)
- `parseInvoice(invoice)`
- `sendPayment(invoice)`
- `waitForPayment(paymentHash)`

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
