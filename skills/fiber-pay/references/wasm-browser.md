# Browser WASM Integration

This document outlines how to integrate the fiber-pay SDK with WebAssembly in browser environments, enabling a complete Fiber Lightning Node to run directly in modern browsers without any local daemon.

## Architecture & Capabilities

The `@fiber-pay/sdk/browser` module wraps the low-level `@nervosnetwork/fiber-js` API to provide robust developer tools:

- **`FiberBrowserNode`**: The high-level orchestrator. Handles node start/stop lifecycle and seamlessly delegates domain methods to the `FiberWasmAdapter`.
- **`FiberWasmAdapter`**: The RPC interface bridge. Wraps JSON-RPC calls into strongly typed asynchronous TypeScript methods while normalizing errors and timeouts.
- **`ConfigBuilder`**: The utility service. Dynamically builds the required YAML configurations needed for the WASM node boot sequence, complete with chain endpoints, static boot nodes, and token settings.

## Cross-Origin Isolation Requirements

Because the WebAssembly implementation utilizes a Rust Tokio runtime internally, multi-threading is necessary to multiplex channels and P2P communication. Doing so enforces a rigid requirement for `SharedArrayBuffer`.

When developing front-ends (e.g., React apps via Vite), you **must** serve your application with strict COEP / COOP headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

In Vite, you can implement this with a simple custom plugin overriding `res.setHeader`. *(Note: Enabling these headers will block loading external cross-origin static assets that do not provide `Cross-Origin-Resource-Policy: cross-origin` in their responses)*.

## Credential & Key Generation

Unlike the Node.js CLI where filesystem APIs are utilized to access keys (`~/.fiber-pay`), the WASM node requires its keys to be fed directly into memory from a secure vault component at startup:

1. **Passkey WebAuthn (`PasskeyCredentialProvider`)**: The recommended solution. Derives a 64-byte payload securely bound to a platform Authenticator (Apple FaceID, Windows Hello) using the PRF extension, bypassing the need for physical persistent passwords.
2. **Password Vault (`PasswordCredentialProvider`)**: Relies on browser-native `IndexedDB` to stash a cryptographic Salt. Once a user inputs a password, SCrypt securely re-derives an identical P2P Key and underlying CKB funding key across browser sessions.

*Read [password-management.md](password-management.md) for more details regarding these specialized browser providers.*

## Polling and Event Observation

WASM operations inside `fiber-pay` may lack traditional native push-based event interfaces (like WebSockets over a TCP port) locally. As a standard practice, high-level SDK operations rely on robust back-off delays or generously configured timeouts. For example, awaiting a newly established channel may span up to 300 seconds to account for CKB layer-1 confirmations entirely within the Web worker boundaries.

---

[← Back to references](./)
