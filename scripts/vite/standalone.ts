import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Plugin, Rollup } from 'vite';

/**
 * The build steps only the standalone web app needs: the journal's migrations embedded as a
 * module, the page's security policy and manifest tags,
 * and the files that make it installable and usable offline. `vite.config.ts` adds them for
 * `--mode standalone` only; the server build never sees any of this.
 */

export const MIGRATIONS_MODULE = 'virtual:moss-migrations';
const RESOLVED_MIGRATIONS = `\0${MIGRATIONS_MODULE}`;

/** The `drizzle` folder's migrations, read at build time and embedded as a module. */
export function mossMigrations(migrationsFolder: string): Plugin {
  return {
    name: 'moss-migrations',
    resolveId: (id) => (id === MIGRATIONS_MODULE ? RESOLVED_MIGRATIONS : null),
    load(id) {
      if (id !== RESOLVED_MIGRATIONS) return null;
      return `export default ${JSON.stringify(readMigrationFiles({ migrationsFolder }))};`;
    },
  };
}

export interface StandaloneOptions {
  /** Where the site is served: `/` on its own domain, `/mossnote/` on a project site. */
  base: string;
  /** The folder of files copied as they are (`src/web/public`). */
  publicDir: string;
  version: string;
}

/** Same-origin only, plus what running SQLite as WebAssembly needs. */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * The page's policy and installability tags. A static host cannot send headers or a fresh nonce
 * per response, so the policy goes in a `<meta>` tag and the nonce Radix's styles need is made
 * once per build. Scripts never get a nonce, so inline scripts stay forbidden.
 */
export function mossStandaloneHtml(options: StandaloneOptions): Plugin {
  const nonce = crypto.randomBytes(16).toString('base64');
  const { base } = options;
  return {
    name: 'moss-standalone-html',
    // The dev server injects inline styles and scripts that a policy this strict would block.
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html
          .replaceAll('__CSP_NONCE__', nonce)
          .replace(
            '<meta charset="UTF-8" />',
            `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(nonce)}" />`,
          )
          .replace(
            '</head>',
            [
              `    <link rel="manifest" href="${base}manifest.webmanifest" />`,
              `    <link rel="apple-touch-icon" href="${base}apple-touch-icon.png" />`,
              '    <meta name="mobile-web-app-capable" content="yes" />',
              '    <meta name="apple-mobile-web-app-capable" content="yes" />',
              '    <meta name="apple-mobile-web-app-title" content="Mossnote" />',
              '  </head>',
            ].join('\n'),
          ),
    },
  };
}

function publicFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? publicFiles(full).map((file) => `${entry.name}/${file}`)
      : [entry.name];
  });
}

/**
 * Files SQLite's library ships beside its WebAssembly that the app never starts (a second worker
 * and the helper for a file system that needs special response headers). They are left out of
 * the offline copy; if something did ask for one, it would come from the network.
 */
const NOT_PRECACHED = /sqlite3-(?:worker1|opfs-async-proxy)/;

/** Text safe to put between single quotes in the service worker's source. */
const jsStringContent = (text: string): string =>
  text.replaceAll('\\', '\\\\').replaceAll("'", "\\'");

const MANIFEST = (base: string) => ({
  name: 'Mossnote',
  short_name: 'Mossnote',
  description: 'A private, spoiler-free journal for the games you play.',
  start_url: base,
  scope: base,
  display: 'standalone',
  background_color: '#f7f5f0',
  theme_color: '#f7f5f0',
  icons: [
    { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' },
    { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' },
    {
      src: `${base}icon-maskable-512.png`,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
});

/**
 * The files that turn the build into an installable, offline-capable site: the manifest, the
 * service worker with the list of everything to keep, and `404.html`. A static host answers an
 * address it does not know with 404.html, so that is the app itself: opening a link into the app
 * (`/journal`) works as well as opening its front page.
 */
export function mossStandalonePwa(options: StandaloneOptions): Plugin {
  const { base, publicDir } = options;
  return {
    name: 'moss-standalone-pwa',
    // After Vite has written index.html into the bundle: the offline copy and 404.html need it.
    generateBundle: {
      order: 'post',
      handler(_output, bundle) {
        const manifest = JSON.stringify(MANIFEST(base), null, 2);
        this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest });

        const index = bundle['index.html'];
        if (index?.type === 'asset') {
          this.emitFile({ type: 'asset', fileName: '404.html', source: index.source });
        }

        const built = Object.keys(bundle).filter((name) => name !== '404.html');
        const kept = built.filter((name) => !NOT_PRECACHED.test(name));
        const files = [...new Set([...kept, ...publicFiles(publicDir), 'manifest.webmanifest'])]
          .sort()
          .map((name) => `${base}${name}`);
        const fingerprint = crypto
          .createHash('sha256')
          .update(
            JSON.stringify([
              options.version,
              ...built.map((name) => [name, bundleHash(bundle[name])]),
            ]),
          )
          .digest('hex')
          .slice(0, 12);

        const template = fs.readFileSync(
          path.join(path.dirname(new URL(import.meta.url).pathname), 'sw.template.js'),
          'utf8',
        );
        const source = template
          .replace('__CACHE_NAME__', `mossnote-${options.version}-${fingerprint}`)
          .replace('__FILES__', () => jsStringContent(JSON.stringify([base, ...files])))
          .replace('__SHELL__', `${base}index.html`);
        this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      },
    },
  };
}

function bundleHash(item: Rollup.OutputAsset | Rollup.OutputChunk | undefined): string {
  const content = item?.type === 'chunk' ? item.code : (item?.source ?? '');
  return crypto.createHash('sha256').update(content).digest('hex');
}
