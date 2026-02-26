import { execSync } from 'node:child_process';
import { defineConfig } from 'tsup';
import packageJson from './package.json';

function resolveHeadCommit(): string {
  try {
    return execSync('git rev-parse HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

const commit = process.env.GIT_COMMIT_SHA?.trim() || resolveHeadCommit();

export default defineConfig({
  entry: { cli: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node20',
  outDir: 'dist',
  shims: true,
  define: {
    'process.env.FIBER_PAY_CLI_VERSION': JSON.stringify(packageJson.version),
    'process.env.FIBER_PAY_CLI_COMMIT': JSON.stringify(commit),
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
});
