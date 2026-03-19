import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/permissions/__tests__/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    globals: false,
  },
});
