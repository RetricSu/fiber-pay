# @fiber-pay/react

React hooks and components for browser payment flows on Fiber.

## Install

```bash
pnpm add @fiber-pay/react react
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

- `className`, `style`, `title`
- `onInvoiceCreated(invoice)`
- `onPaymentResult(result)`
- `onError({ scope, message })`

## ConnectButton

Use `ConnectButton` with an existing `useFiberNode` result for drop-in integration.

```tsx
import { ConnectButton, useFiberNode } from '@fiber-pay/react';
import { Fiber } from '@nervosnetwork/fiber-js';

export function HeaderWallet() {
  const fiber = useFiberNode({ network: 'testnet', wasmFactory: () => new Fiber() });
  return <ConnectButton fiber={fiber} />;
}
```

For custom connected-state panels (for example peer/channel controls), use `renderConnectedDropdown`:

```tsx
<ConnectButton
  fiber={fiber}
  dropdownStyle={{ width: 320 }}
  renderConnectedDropdown={({ fiber, disconnect, closeDropdown }) => (
    <div>
      <div>State: {fiber.state}</div>
      <button
        type="button"
        onClick={() => {
          void disconnect();
          closeDropdown();
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
