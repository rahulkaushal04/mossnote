import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const src = (dir: string) => fileURLToPath(new URL(`./src/${dir}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: { __MOSS_DEV_KIT__: false, __MOSS_STANDALONE__: false },
  resolve: {
    alias: {
      '@shared': src('shared'),
      '@server': src('server'),
      '@web': src('web'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
