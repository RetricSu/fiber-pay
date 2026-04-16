import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/lib/**/*.test.ts'],
    globals: false,
  },
});
