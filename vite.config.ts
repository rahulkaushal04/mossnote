import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  mossMigrations,
  mossStandaloneHtml,
  mossStandalonePwa,
} from './scripts/vite/standalone.ts';

const src = (dir: string) => fileURLToPath(new URL(`./src/${dir}`, import.meta.url));
const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const pkg = JSON.parse(fs.readFileSync(root('./package.json'), 'utf8')) as { version: string };

/** Keeps the hidden /dev/kit route out of real production builds. */
const devKit = (include: boolean): Plugin => ({
  name: 'moss-dev-kit',
  config: () => ({ define: { __MOSS_DEV_KIT__: JSON.stringify(include) } }),
});

/**
 * Where the standalone web app is served: `/` by default (its own domain, or `vite preview`),
 * or `MOSS_BASE=/repository-name/` for a GitHub project site.
 */
function standaloneBase(): string {
  const base = process.env.MOSS_BASE ?? '/';
  return `${base.startsWith('/') ? '' : '/'}${base}${base.endsWith('/') ? '' : '/'}`;
}

// `--mode e2e` is a production build that also includes /dev/kit, so the end-to-end tests can
// exercise the Radix primitives under the full CSP. `npm run build` never includes it.
// `--mode standalone` builds the web app that keeps the journal in the browser, with no server
// (`npm run build:standalone`); it goes to dist/standalone and is never part of the npm package.
export default defineConfig(({ mode, command }) => {
  const standalone = mode === 'standalone';
  const base = standalone ? standaloneBase() : '/';
  const standaloneOptions = { base, publicDir: src('web/public'), version: pkg.version };
  return {
    root: src('web'),
    base,
    publicDir: src('web/public'),
    plugins: [
      react(),
      tailwindcss(),
      devKit(command === 'serve' || mode === 'e2e'),
      ...(standalone
        ? [
            mossMigrations(root('./drizzle')),
            mossStandaloneHtml(standaloneOptions),
            mossStandalonePwa(standaloneOptions),
          ]
        : []),
    ],
    define: {
      __MOSS_STANDALONE__: JSON.stringify(standalone),
      __MOSS_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: [
        { find: '@shared', replacement: src('shared') },
        { find: '@server', replacement: src('server') },
        { find: '@web', replacement: src('web') },
        // Drizzle's driver imports the native SQLite module, which cannot run in a browser and is
        // never used there. An alias, unlike a plugin, also reaches the dev server's pre-bundling.
        ...(standalone
          ? [{ find: /^better-sqlite3$/, replacement: root('./scripts/vite/noNativeSqlite.ts') }]
          : []),
      ],
    },
    // SQLite's WebAssembly library finds its `.wasm` file relative to itself, which Vite's
    // dependency pre-bundling would move.
    optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
    // The worker that holds the journal is bundled on its own and needs the same extra plugins.
    worker: {
      format: 'es' as const,
      plugins: () => [mossMigrations(root('./drizzle'))],
    },
    build: {
      outDir: root(standalone ? './dist/standalone' : './dist/web'),
      emptyOutDir: true,
      sourcemap: false,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'react',
                test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                priority: 30,
              },
              {
                name: 'radix',
                test: /node_modules[\\/](@radix-ui|cmdk|@floating-ui|aria-hidden|react-remove-scroll)/,
                priority: 20,
              },
              {
                name: 'data',
                test: /node_modules[\\/](react-router|@tanstack|zod)/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:4317' } },
    },
  };
});
