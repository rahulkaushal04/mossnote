import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const src = (dir: string) => fileURLToPath(new URL(`./src/${dir}`, import.meta.url));

/** Keeps the hidden /dev/kit route out of real production builds. */
const devKit = (include: boolean): Plugin => ({
  name: 'moss-dev-kit',
  config: () => ({ define: { __MOSS_DEV_KIT__: JSON.stringify(include) } }),
});

// `--mode e2e` is a production build that also includes /dev/kit, so the end-to-end tests can
// exercise the Radix primitives under the full CSP. `npm run build` never includes it.
export default defineConfig(({ mode, command }) => ({
  root: src('web'),
  publicDir: src('web/public'),
  plugins: [react(), tailwindcss(), devKit(command === 'serve' || mode === 'e2e')],
  resolve: {
    alias: { '@shared': src('shared'), '@server': src('server'), '@web': src('web') },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4317' } },
  },
}));
