import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // test/node runs with node:test against dist/ (pnpm test:node)
    exclude: [...configDefaults.exclude, 'test/node/**'],
  },
});
