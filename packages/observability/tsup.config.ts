import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'middleware/hono': 'src/middleware/hono.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
});
