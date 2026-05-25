import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite plugin to set Cross-Origin Isolation headers on all responses.
 * Required for SharedArrayBuffer support in WASM threads.
 */
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

export default defineConfig({
  plugins: [react(), crossOriginIsolation()],
  server: {
    port: 5174,
  },
  build: {
    // Browser Fiber WASM artifacts are intentionally large in this demo app.
    chunkSizeWarningLimit: 20000,
  },
});
