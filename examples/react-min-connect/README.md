# React Minimal Integration Example

Layer: React integration (minimal)

Audience:

- Developers who want the fastest possible Fiber browser connect entry.

You will learn:

1. Initialize useFiberNode with network and walletId.
2. Switch ConnectButton strategy between password and passkey.
3. Receive onConnect/onDisconnect/onError/onLog callbacks.
4. Render minimal runtime state (state, running, pubkey).

Out of scope:

1. FiberNodeButton advanced tabs and custom renderers.
2. Peer/channel/payment operation panels.
3. Browser SDK low-level RPC helper usage.

## Run

```bash
pnpm -C examples/react-min-connect dev
```

Build:

```bash
pnpm -C examples/react-min-connect build
```

Then open http://localhost:5175.

## API Index

- useFiberNode (from @fiber-pay/react)
- ConnectButton (from @fiber-pay/react)

## Next Step

If you need a richer component layer (default tabbed panel + custom tabs/actions), continue to examples/react-fiber-node-button-lab.
