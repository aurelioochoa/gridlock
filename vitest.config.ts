import { defineConfig } from 'vitest/config';

// src/sim/ is pure: the tests that matter need no DOM (design §12).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // lots.test.ts re-solves all 130 frozen lots from scratch; that is the point of it.
    testTimeout: 300_000,
  },
});
