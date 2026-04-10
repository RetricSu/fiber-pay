# @fiber-pay/react

React hooks and components for browser payment flows on Fiber.

## Install

```bash
pnpm add @fiber-pay/react react
```

## One-line import

```tsx
import { FiberPayQuickCard, useFiberNode, useFiberPayment } from '@fiber-pay/react';
```

## Quick start

```tsx
import { FiberPayQuickCard } from '@fiber-pay/react';

export function App() {
  return <FiberPayQuickCard network="testnet" />;
}
```

## Hooks

- `useFiberNode(options)`
- `useFiberPayment(node)`

`useFiberNode` exposes passkey/password startup and node lifecycle methods.
