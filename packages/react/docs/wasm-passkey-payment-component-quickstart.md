# Browser WASM + Passkey: Build a Payment UI in Minutes

This guide shows frontend developers how to build a user payment component with `@fiber-pay/react` and `@fiber-pay/sdk/browser` using the smallest possible setup.

## TL;DR

You can build a working browser payment flow with three building blocks:

- `FiberBrowserNode`
- `PasskeyCredentialProvider`
- a tiny React hook/component wrapper

Or use the new React package directly:

```tsx
import { FiberPayQuickCard } from '@fiber-pay/react';
```

## What You Get Today

- `@fiber-pay/react`: official React hooks and starter components (`useFiberNode`, `useFiberPayment`, `ConnectButton`, `FiberNodeButton`, `FiberPayQuickCard`, `NodeInfoPanel`)
- `@fiber-pay/sdk/browser`: low-level browser API when you need deeper control

## 1) Install

```bash
pnpm add @fiber-pay/react react @nervosnetwork/fiber-js
# optional, for QR codes in NodeInfoPanel
pnpm add qrcode.react
```

If you prefer lower-level control without React abstractions:

```bash
pnpm add @fiber-pay/sdk @nervosnetwork/fiber-js
```

## Browser Requirements (Must Read)

For browser multithreaded WASM runtime (`SharedArrayBuffer`), your app must serve:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Without these headers, `FiberBrowserNode.start()` can fail at runtime.

Vite example plugin:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Plugin } from 'vite';

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
```

Note: this `configureServer` middleware only affects local Vite dev server.
In production, configure COOP/COEP headers on your web server or CDN.

## 2) Smallest Passkey Startup (No UI)

```ts
import {
  FiberBrowserNode,
  PasskeyCredentialProvider,
} from '@fiber-pay/sdk/browser';

const credential = new PasskeyCredentialProvider('my-wallet-testnet');
const node = new FiberBrowserNode({ network: 'testnet', credential });

// First time only: await credential.register('alice');
await node.start();
const info = await node.getNodeInfo();
console.log('Node pubkey:', info.pubkey);
```

That is enough to boot a local browser WASM node with passkey unlock.

## 3) 30-Line React Hook

If you want full control over UX/state, you can still write your own app hook on top of `@fiber-pay/sdk/browser`.

Use this hook as your app-level integration seam.

```tsx
import { useMemo, useState } from 'react';
import {
  FiberBrowserNode,
  PasskeyCredentialProvider,
  type NodeInfoResult,
} from '@fiber-pay/sdk/browser';

export function useQuickFiberPay(network: 'testnet' | 'mainnet' = 'testnet') {
  const [nodeInfo, setNodeInfo] = useState<NodeInfoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const credential = useMemo(
    () => new PasskeyCredentialProvider(`wallet-${network}`),
    [network],
  );

  const node = useMemo(
    () => new FiberBrowserNode({ network, credential }),
    [network, credential],
  );

  const registerAndStart = async (username = 'User') => {
    setError(null);
    try {
      await credential.register(username);
      const info = await node.start();
      setNodeInfo(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loginAndStart = async () => {
    setError(null);
    try {
      const info = await node.start();
      setNodeInfo(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stop = async () => {
    await node.stop();
    setNodeInfo(null);
  };

  return { node, nodeInfo, error, registerAndStart, loginAndStart, stop };
}
```

## 4) Minimal Payment Component

This component demonstrates a simple "create invoice + send payment" user flow.

```tsx
import { useState } from 'react';
import { useQuickFiberPay } from './useQuickFiberPay';

export function QuickPayCard() {
  const { node, nodeInfo, error, registerAndStart, loginAndStart, stop } = useQuickFiberPay('testnet');
  const [invoice, setInvoice] = useState('');
  const [createdInvoice, setCreatedInvoice] = useState('');

  const createInvoice = async () => {
    const res = await node.newInvoice({
      amount: '0x5f5e100', // 1 CKB in shannons
      description: 'QuickPay demo',
    });
    setCreatedInvoice(res.invoice_address);
  };

  const send = async () => {
    await node.sendPayment({ invoice });
  };

  return (
    <div>
      {!nodeInfo ? (
        <>
          <button onClick={() => void registerAndStart('demo-user')}>Register Passkey</button>
          <button onClick={() => void loginAndStart()}>Login with Passkey</button>
        </>
      ) : (
        <>
          <p>Running as: {nodeInfo.pubkey}</p>
          <button onClick={() => void createInvoice()}>Create Invoice</button>
          {createdInvoice && <pre>{createdInvoice}</pre>}
          <input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Paste invoice" />
          <button onClick={() => void send()}>Pay</button>
          <button onClick={() => void stop()}>Stop</button>
        </>
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

## 5) Is It Really "Few Lines"?

Yes, if you only need:

- passkey registration/login
- node startup
- invoice creation / payment send

Then the core logic is already just a few calls:

```ts
const credential = new PasskeyCredentialProvider('wallet-id');
const node = new FiberBrowserNode({ network: 'testnet', credential });
await credential.register('alice'); // first time
await node.start();
await node.newInvoice({ amount: '0x5f5e100', description: 'hello' });
```

## 6) Current Abstraction Level (Important)

- React package: official hooks and starter component are available in `@fiber-pay/react`.
- SDK browser API: still available for advanced integrations and custom abstractions.
- Demo apps:
  - `examples/browser-sdk-playground`: full-featured browser wallet console style SDK/browser playground.
  - `examples/react-fiber-node-button-lab`: downstream integration demo focused on `FiberNodeButton` extension patterns.

Recommended approach:

1. Start with `@fiber-pay/react` for fastest integration.
2. Drop to `@fiber-pay/sdk/browser` when you need custom lifecycle/routing behavior.
3. Keep final UI/branding in your own component system.

## React SDK Tutorial (Dogfood Pattern)

These integration patterns are used across the demo apps:

- `examples/browser-sdk-playground`: browser SDK-first integration with direct RPC/helper calls.
- `examples/react-fiber-node-button-lab`: component-layer integration with `FiberNodeButton` and callback wiring.

- Use `useFiberNode` for node lifecycle and passkey diagnostics.
- Keep business UI in your own component tree.
- Optionally embed `FiberPayQuickCard` for rapid MVP flows.

### A) Hook-first integration (recommended)

```tsx
import { useFiberNode } from '@fiber-pay/react';

export function WalletNodePanel() {
  const {
    state,
    node,
    nodeInfo,
    isPasskeySupported,
    passkeySupportReason,
    passkeyUnavailableReason,
    hasPasskeyConfigured,
    startWithPassword,
    startWithPasskey,
    createPasskeyAndStart,
    stop,
  } = useFiberNode({
    network: 'testnet',
    walletId: 'wallet-demo-testnet',
  });

  if (!nodeInfo) {
    return (
      <div>
        {isPasskeySupported ? (
          hasPasskeyConfigured ? (
            <button onClick={() => void startWithPasskey()}>Login with Passkey</button>
          ) : (
            <button onClick={() => void createPasskeyAndStart('DemoUser')}>Register Passkey</button>
          )
        ) : (
          <p>
            Passkey unavailable: {passkeyUnavailableReason} (reason: {passkeySupportReason})
          </p>
        )}

        <button onClick={() => void startWithPassword('demo-secret')}>Start with Password</button>
      </div>
    );
  }

  return (
    <div>
      <p>State: {state}</p>
      <p>Pubkey: {nodeInfo.pubkey}</p>
      <p>Node ready: {String(Boolean(node))}</p>
      <button onClick={() => void stop()}>Stop</button>
    </div>
  );
}
```

What this gives you:

- Better passkey UX with explicit fallback messaging.
- Fully custom UI while still using official lifecycle APIs.
- A clean seam to plug in your own monitoring, logging, and analytics.

### B) Quick MVP with callback instrumentation

`FiberPayQuickCard` now supports callback hooks so you can plug telemetry/alerts without rewriting core flow.

```tsx
import { FiberPayQuickCard } from '@fiber-pay/react';

export function QuickPaySection() {
  return (
    <FiberPayQuickCard
      network="testnet"
      title="Demo Quick Pay"
      className="quick-card"
      onInvoiceCreated={(invoice) => {
        console.log('invoice created', invoice);
      }}
      onPaymentResult={(result) => {
        console.log('payment result', result.status);
      }}
      onError={(event) => {
        console.error(`[${event.scope}]`, event.message);
      }}
    />
  );
}
```

Use this path when you want to ship a functional payment panel quickly, then progressively replace UI with your own components.

## 7) Production Notes

- Use HTTPS in production for WebAuthn.
- Treat browser XSS hardening as top priority (CSP, script hygiene, strict dependency review).
- Avoid exposing privileged backend tokens in browser bundles.
- For browser multithreaded WASM runtime, keep COOP/COEP settings correctly configured.
- Expect a large WASM-related bundle chunk (roughly ~14 MB raw, ~6.5 MB gzip in current demos);
  use route-level split/lazy mounting for payment-heavy UI.

## 8) Reference Paths

- React package entry: `packages/react/src/index.ts`
- React hooks: `packages/react/src/use-fiber-node.ts`, `packages/react/src/use-fiber-payment.ts`
- Starter component: `packages/react/src/fiber-pay-quick-card.tsx`
- SDK browser entry: `packages/sdk/src/browser/index.ts`
- Browser node API: `packages/sdk/src/browser/fiber-browser-node.ts`
- Passkey provider: `packages/sdk/src/browser/passkey-credential-provider.ts`
- Demo apps:
  - `examples/browser-sdk-playground/src/App.tsx`
  - `examples/react-fiber-node-button-lab/src/App.tsx`
