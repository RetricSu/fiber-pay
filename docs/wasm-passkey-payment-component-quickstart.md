# Browser WASM + Passkey: Build a Payment UI in Minutes

This guide shows frontend developers how to build a user payment component with `@fiber-pay/sdk/browser` using the smallest possible setup.

## TL;DR

You can build a working browser payment flow with only three building blocks:

- `FiberBrowserNode`
- `PasskeyCredentialProvider`
- a tiny React hook/component wrapper

Or use the new React package directly:

```tsx
import { FiberPayQuickCard } from '@fiber-pay/react';
```

## What You Get Today

`@fiber-pay/sdk/browser` currently provides a high-level browser node API, but does **not** ship official React UI components.

You can still move very fast by using:

- SDK primitives from `@fiber-pay/sdk/browser`
- reference hooks in `apps/browser-wallet/src/hooks/` (`useFiberNode`, `useFiberConsole`, `useFiberPayment`)

If needed, you can copy these hooks into your app or extract them into your internal design system package.

## 1) Install

```bash
pnpm add @fiber-pay/react react
```

If you prefer lower-level control without React abstractions:

```bash
pnpm add @fiber-pay/sdk @nervosnetwork/fiber-js
```

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

- SDK: high-level browser node API is ready (`FiberBrowserNode`)
- SDK: passkey/password/raw-key credential providers are ready
- SDK: no official React components exported yet
- Repo demo: has reusable React hooks in `apps/browser-wallet/src/hooks/`

So the current best practice is:

1. Use SDK browser API directly for production logic.
2. Copy and adapt demo hooks as your app-layer abstraction.
3. Keep UI component state in your own design system.

## 7) Production Notes

- Use HTTPS in production for WebAuthn.
- Treat browser XSS hardening as top priority (CSP, script hygiene, strict dependency review).
- Avoid exposing privileged backend tokens in browser bundles.
- For browser multithreaded WASM runtime, keep COOP/COEP settings correctly configured.

## 8) Reference Paths

- SDK browser entry: `packages/sdk/src/browser/index.ts`
- Browser node API: `packages/sdk/src/browser/fiber-browser-node.ts`
- Passkey provider: `packages/sdk/src/browser/passkey-credential-provider.ts`
- Demo hooks: `apps/browser-wallet/src/hooks/useFiberNode.ts`
- Demo app: `apps/browser-wallet/src/App.tsx`
