import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/openai.ts', 'src/anthropic.ts', 'src/ai-sdk.ts', 'src/server.ts', 'src/testing.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // Named exports in CJS; scripts/cjs-interop.mjs makes require() return the client class
  outputOptions: { exports: 'named' },
});
