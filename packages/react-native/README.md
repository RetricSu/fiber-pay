# @fiber-pay/react-native

React Native hooks for Fiber Network payments.

**Status: experimental.** The connection and invoice-creation paths are
smoke-tested against a live testnet `fnn` node; `payInvoice` has unit
test coverage (including concurrency and routing-failure paths) but has
not yet been run end to end against two funded nodes. See
[examples/react-native-min-connect](../../examples/react-native-min-connect)
for a real RN/Expo consumer.

## Why this package exists

`@fiber-pay/react` runs a Fiber node locally in the browser via WASM. React
Native has no WASM + IndexedDB runtime to host that, so this package takes a
different approach: it connects to a **remote** `fnn` node over its JSON-RPC
endpoint using `FiberRpcClient` from `@fiber-pay/sdk`, which has no
browser-only or Node-only dependencies and works with React Native's global
`fetch`.

This package is a client for a remote node you already run and trust — it
does not run a Fiber node on-device. See **Security** below before pointing
it at anything other than your own development node.

## Supported versions

Tested against: React 19.3.x, React Native 0.88.x, Expo SDK 58, Node
>=22.13.0 (required by React Native 0.88's own tooling). Other combinations
may work but aren't part of this package's CI.

## Install

```sh
npm install @fiber-pay/react-native
# or
pnpm add @fiber-pay/react-native
```

`react` and `react-native` are peer dependencies — use the versions your
app already has.

## Quickstart

```tsx
import { useFiberNode, useFiberPayment } from '@fiber-pay/react-native';
import { useState } from 'react';
import { Button, Text, View } from 'react-native';

function PaymentScreen() {
  const { state, nodeInfo, error: nodeError, client, isReady } = useFiberNode({
    // 127.0.0.1 only works when the node runs on the same device as the
    // app (e.g. a desktop dev build). On a physical device or an Android
    // emulator, point this at your machine's LAN IP (emulators also have
    // their own host aliases, e.g. 10.0.2.2 on the Android emulator) and
    // use HTTPS with a real certificate — iOS App Transport Security and
    // Android's cleartext-traffic policy both block plain HTTP by default
    // outside of local development.
    url: 'http://127.0.0.1:8227',
  });
  const { createInvoice, payInvoice, isPaying, error: paymentError } = useFiberPayment(client, {
    network: 'testnet',
  });
  const [invoiceAddress, setInvoiceAddress] = useState<string | null>(null);

  if (state === 'connecting') return <Text>Connecting…</Text>;
  if (state === 'error') return <Text>Could not reach the node: {nodeError}</Text>;

  const handleCreateInvoice = async () => {
    try {
      const invoice = await createInvoice({ amount: '0x5f5e100', currency: 'Fibt' });
      setInvoiceAddress(invoice.invoice_address);
    } catch (err) {
      // `error` from the hook is also set; this catch is for local handling
      // (e.g. showing a toast) if you need it immediately.
      console.warn('Failed to create invoice:', err);
    }
  };

  const handlePay = async (invoice: string) => {
    try {
      const result = await payInvoice(invoice);
      console.log('Paid, settled with status:', result.status);
    } catch (err) {
      console.warn('Payment failed:', err);
    }
  };

  return (
    <View>
      <Text>Connected to {nodeInfo?.version}</Text>
      <Button title="Create invoice" onPress={handleCreateInvoice} disabled={!isReady} />
      {invoiceAddress ? <Text selectable>{invoiceAddress}</Text> : null}
      <Button
        title="Pay"
        onPress={() => invoiceAddress && handlePay(invoiceAddress)}
        disabled={!isReady || isPaying}
      />
      {paymentError ? <Text>{paymentError}</Text> : null}
    </View>
  );
}
```

## API

### `useFiberNode(options)`

Connects to a remote `fnn` node, polling with bounded, backed-off retries
until it either becomes reachable or `maxRetries` is exhausted (default 5),
at which point `state` becomes `'error'` with the last failure in `error`.

```ts
interface UseFiberNodeOptions {
  url: string;
  /** Forwarded to FiberRpcClient: request timeout in ms. */
  timeout?: number;
  /** Forwarded to FiberRpcClient: custom headers. */
  headers?: Record<string, string>;
  /** Forwarded to FiberRpcClient: Biscuit auth token. Prefer a trusted
   *  backend/proxy over embedding a long-lived privileged token in the app. */
  biscuitToken?: string;
  pollIntervalMs?: number; // default 2000
  maxPollIntervalMs?: number; // default 30000
  maxRetries?: number; // default 5
  enabled?: boolean; // default true
}
```

Returns `{ state, client, nodeInfo, error, isReady, reconnect }`. `state` is
one of `'idle' | 'connecting' | 'ready' | 'error'`.

### `useFiberPayment(client, options?)`

Takes the `client` from `useFiberNode`. CKB-only for now: `payInvoice`
rejects invoices carrying a UDT type script, and (when `options.network` is
set) invoices on the wrong network.

```ts
interface UseFiberPaymentOptions {
  network?: 'testnet' | 'mainnet';
}
```

Returns `{ createInvoice, parseInvoice, payInvoice, isPaying, paymentResult, error }`.

`payInvoice` differs from `@fiber-pay/react`'s hook of the same name: the
browser version returns `Promise<void>` and swallows errors into its
`error` state; this one resolves with the settled `GetPaymentResult` and
rethrows on failure (in addition to still setting `error`), so a caller can
`await` it directly — e.g. to navigate on success. Only one `payInvoice`
call may be in flight per client at a time; a second call on the same client
while one is pending rejects immediately rather than racing it.

## Security

- This package talks to a Fiber node you point it at. Do not expose an
  unauthenticated `fnn` RPC endpoint publicly — use `headers`/`biscuitToken`
  with a node that requires auth, ideally via a trusted backend/proxy
  rather than embedding long-lived credentials in the app binary.
- On iOS, plain HTTP to a non-local host is blocked by App Transport
  Security by default; on Android, cleartext HTTP is blocked by default
  outside of development builds. Use HTTPS for anything beyond local
  development.

## Architecture note

This hook's shape intentionally mirrors `@fiber-pay/react`'s
`useFiberPayment` (parse → send → wait, plus the same client-generation /
mounted-guard pattern) rather than introducing a third divergent contract.
A shared `IFiberClient`-based orchestration layer between the two packages
would remove the duplication entirely; that's a larger cross-package
refactor left for a follow-up rather than bundled into this PR.
