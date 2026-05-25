# Browser SDK Playground

Layer: Browser SDK layer (@fiber-pay/sdk/browser)

Audience:

- Developers who want direct browser SDK control without React helper abstractions.

You will learn:

1. Start/stop a browser node with FiberBrowserNode and credential providers.
2. Use BrowserRpcClient against a configurable RPC endpoint.
3. Call nodeInfo/listPeers/listChannels via browser RPC client.
4. Use browser-only helpers such as scriptToAddress and getLockBalanceShannons.

Out of scope:

1. ConnectButton or FiberNodeButton component integration.
2. Advanced component customization and callback instrumentation.
3. Node-side recipe scripting patterns.

## Run

```bash
pnpm -C examples/browser-sdk-playground dev
```

Build:

```bash
pnpm -C examples/browser-sdk-playground build
```

Then open http://localhost:5176.

## API Index

- FiberBrowserNode
- PasswordCredentialProvider / PasskeyCredentialProvider
- BrowserRpcClient
- scriptToAddress
- getLockBalanceShannons
- formatShannonsAsCkb

## Next Step

If you want Node/CLI automation recipes using universal SDK client, continue to examples/sdk-node-recipes.
