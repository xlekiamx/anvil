import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'bin/anvil.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  shims: false,
});
