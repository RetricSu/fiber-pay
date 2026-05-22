# @fiber-pay/react

React hooks and components for browser payment flows on Fiber.

## Install

```bash
pnpm add @fiber-pay/react @nervosnetwork/fiber-js react
```

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

For external funding, pass `externalFunding` with an async `resolve` callback that returns
`signFundingTx` and optional script / dep overrides.

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

## Hooks

- `useFiberNode(options)`
- `useFiberPayment(node)`

`useFiberNode` exposes passkey/password startup, node lifecycle methods, and passkey diagnostics (`passkeySupportReason`, `passkeyUnavailableReason`).
