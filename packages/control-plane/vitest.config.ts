import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
