import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      agrune: resolve(__dirname, '../agrune/src/api.ts'),
      '@agrune/manifest': resolve(__dirname, '../agrune/packages/manifest/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      external: ['electron', 'playwright', ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    },
  },
});
