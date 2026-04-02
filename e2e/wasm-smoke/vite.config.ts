import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';

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
      '@sdk': resolve(__dirname, '../../packages/sdk/src'),
    },
  },
});
