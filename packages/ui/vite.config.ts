import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { CSP_META } from './src/csp';

/** Injects the CSP as a <meta> so file: pages are covered even where the header hook is not. Build only (dev needs inline HMR). */
export function cspPlugin(): Plugin {
  return {
    name: 'mossnote-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_META },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

// Relative base so the Electron shell can load dist/index.html from disk (no server, no network).
export default defineConfig({
  base: './',
  plugins: [react(), cspPlugin()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2023' },
});
