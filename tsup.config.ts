import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/server/index.ts' },
  outDir: 'dist/server',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  tsconfig: 'tsconfig.server.json',
  clean: true,
  sourcemap: false,
  // Runtime dependencies (including the native better-sqlite3) are left external.
  external: ['better-sqlite3'],
});
