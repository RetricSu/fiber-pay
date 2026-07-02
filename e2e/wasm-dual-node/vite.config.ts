import { defineConfig, type Plugin } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Vite plugin to set Cross-Origin Isolation headers on all responses.
 * Required for SharedArrayBuffer support in WASM threads.
 */
function crossOriginIsolation(): Plugin {
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [crossOriginIsolation()],
  server: {
    fs: {
      allow: ['../..'],
    },
  },
  resolve: {
    alias: {
      // Resolve the public SDK browser entry from source so the E2E runs without
      // a prebuilt dist/ (mirrors the wasm-smoke setup and keeps CI self-contained).
      '@fiber-pay/sdk/browser': resolve(__dirname, '../../packages/sdk/src/browser/index.ts'),
      '@sdk': resolve(__dirname, '../../packages/sdk/src'),
    },
  },
});
