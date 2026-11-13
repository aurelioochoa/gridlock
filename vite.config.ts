import { defineConfig } from 'vite';

// base: './' is load-bearing: the bundle must run unmodified under /g/gridlock/ on the
// site as well as at the root in dev (design §12).
export default defineConfig({
  base: './',
  server: { port: 5183, host: true },
  preview: { port: 4183 },
  build: {
    target: 'es2020',
    // Design §12: ≤ 300 KB enforced, < 100 KB expected. check-licenses.mjs enforces it.
    chunkSizeWarningLimit: 300,
  },
});
