# React FiberNodeButton Lab

Layer: React component layer (FiberNodeButton)

Audience:

- Teams integrating FiberNodeButton into application UI and extending panel behavior.

You will learn:

1. useFiberNode plus FiberNodeButton default management panel flow.
2. Custom tabs configuration (add/hide/reorder tabs).
3. renderAction override for selected actions.
4. t callback for lightweight i18n overrides.
5. externalFunding.resolve integration path with CCC signer handoff.

Out of scope:

1. Minimal connection-only integration (see react-min-connect).
2. Direct browser SDK client/helper usage without React wrappers.
3. Node-side recipe scripting.

## Run

```bash
pnpm -C examples/react-fiber-node-button-lab dev
```

Build:

```bash
pnpm -C examples/react-fiber-node-button-lab build
```

Then open http://localhost:5174.

## API Index

- useFiberNode
- FiberNodeButton
- FiberNodeButton tabs prop
- FiberNodeButton renderAction prop
- FiberNodeButton t prop

## Next Step

If you need direct browser RPC and helper operations without React helper components, continue to examples/browser-sdk-playground.
