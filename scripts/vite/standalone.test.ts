import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS_MODULE,
  mossMigrations,
  mossStandaloneHtml,
  mossStandalonePwa,
} from './standalone.ts';
import NoNativeSqlite from './noNativeSqlite.ts';

const DRIZZLE = path.resolve(import.meta.dirname, '..', '..', 'drizzle');

/** Plugin hooks come as a function or as `{ handler }`; these tests call them directly. */
function hook<T extends (...args: never[]) => unknown>(value: T | { handler: T } | undefined): T {
  if (!value) throw new Error('The plugin has no such hook.');
  return typeof value === 'function' ? value : value.handler;
}

describe('the embedded migrations', () => {
  const plugin = mossMigrations(DRIZZLE);
  const resolve = hook(plugin.resolveId as (id: string) => unknown);
  const load = hook(plugin.load as (id: string) => unknown);

  it('turns the migrations module into one that holds exactly what the drizzle folder holds', () => {
    const id = resolve(MIGRATIONS_MODULE) as string;
    const source = load(id) as string;

    const embedded = JSON.parse(
      source.replace(/^export default /, '').replace(/;$/, ''),
    ) as unknown;

    expect(embedded).toEqual(readMigrationFiles({ migrationsFolder: DRIZZLE }));
  });

  it('leaves every other module alone', () => {
    expect(resolve('react')).toBeNull();
    expect(load('react')).toBeNull();
  });
});

describe('the stand-in for the native SQLite module', () => {
  it('fails loudly if anything ever tries to use it', () => {
    expect(() => NoNativeSqlite()).toThrow('not available in the browser');
  });
});

describe('the page', () => {
  const html = [
    '<!doctype html><html><head>',
    '<meta charset="UTF-8" />',
    '<meta name="csp-nonce" content="__CSP_NONCE__" />',
    '</head><body></body></html>',
  ].join('\n');
  const options = { base: '/mossnote/', publicDir: '/unused', version: '1.2.3' };
  const transform = hook(
    mossStandaloneHtml(options).transformIndexHtml as unknown as {
      handler: (html: string) => string;
    },
  );

  it('carries a security policy that allows only itself, plus WebAssembly', () => {
    const page = transform(html);

    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page)?.[1] ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toMatch(/https?:/);
    expect(policy).not.toContain("'unsafe-inline'");
  });

  it('uses one nonce for the styles Radix injects, in the policy and in the page', () => {
    const page = transform(html);

    const inPolicy = /style-src 'self' 'nonce-([^']+)'/.exec(page)?.[1];
    const inMeta = /name="csp-nonce" content="([^"]+)"/.exec(page)?.[1];
    expect(inPolicy).toBeTruthy();
    expect(inMeta).toBe(inPolicy);
    expect(page).not.toContain('__CSP_NONCE__');
  });

  it('gives each build its own nonce', () => {
    const other = hook(
      mossStandaloneHtml(options).transformIndexHtml as unknown as {
        handler: (html: string) => string;
      },
    );

    expect(/nonce-([^']+)'/.exec(transform(html))?.[1]).not.toBe(
      /nonce-([^']+)'/.exec(other(html))?.[1],
    );
  });

  it('links the manifest and the Home Screen icon under the base path', () => {
    const page = transform(html);

    expect(page).toContain('<link rel="manifest" href="/mossnote/manifest.webmanifest" />');
    expect(page).toContain('href="/mossnote/apple-touch-icon.png"');
  });
});

describe('the offline files', () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-public-'));
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), '<svg/>');
  fs.writeFileSync(path.join(publicDir, 'icon-192.png'), 'png');

  const emitted = new Map<string, string>();
  const context = {
    emitFile: (file: { fileName: string; source: string }) => {
      emitted.set(file.fileName, file.source);
    },
  };
  const asset = (source: string) => ({ type: 'asset', source });
  const chunk = (code: string) => ({ type: 'chunk', code });
  const bundle = {
    'index.html': asset('<html>app</html>'),
    'assets/index-abc.js': chunk('console.log(1)'),
    'assets/sqlite3-xyz.wasm': asset('wasm'),
    'assets/sqlite3-worker1-abc.js': chunk('unused worker'),
    'assets/sqlite3-opfs-async-proxy-abc.js': chunk('unused proxy'),
  };
  const plugin = mossStandalonePwa({ base: '/mossnote/', publicDir, version: '1.2.3' });
  hook(plugin.generateBundle as never as (this: unknown, o: object, b: object) => void).call(
    context,
    {},
    bundle,
  );

  it('writes a manifest that starts the app at its base path', () => {
    const manifest = JSON.parse(emitted.get('manifest.webmanifest') ?? '{}') as {
      start_url: string;
      scope: string;
      display: string;
      icons: { src: string; purpose?: string }[];
    };

    expect(manifest).toMatchObject({
      start_url: '/mossnote/',
      scope: '/mossnote/',
      display: 'standalone',
    });
    expect(manifest.icons.map((icon) => icon.src)).toContain('/mossnote/icon-maskable-512.png');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('writes 404.html as a copy of the app, so a link into it works on a static host', () => {
    expect(emitted.get('404.html')).toBe('<html>app</html>');
  });

  it('writes a service worker that is valid script and keeps every file the app needs', () => {
    const source = emitted.get('sw.js') ?? '';
    const listeners = new Map<string, unknown>();
    const scope = {
      self: { addEventListener: (type: string, fn: unknown) => listeners.set(type, fn) },
      caches: {},
    };

    vm.runInNewContext(source, scope);

    const cached = JSON.parse(/JSON\.parse\('(.*)'\)/.exec(source)?.[1] ?? '[]') as string[];
    expect(listeners.size).toBe(4);
    expect(cached).toEqual(
      expect.arrayContaining([
        '/mossnote/',
        '/mossnote/index.html',
        '/mossnote/assets/index-abc.js',
        '/mossnote/assets/sqlite3-xyz.wasm',
        '/mossnote/favicon.svg',
        '/mossnote/icon-192.png',
        '/mossnote/manifest.webmanifest',
      ]),
    );
    expect(cached.join()).not.toContain('404.html');
  });

  it('leaves out the library files the app never starts', () => {
    const source = emitted.get('sw.js') ?? '';

    expect(source).not.toContain('sqlite3-worker1');
    expect(source).not.toContain('sqlite3-opfs-async-proxy');
  });

  it('names the cache after the version and the files, so a new build replaces the old copy', () => {
    const name = /const CACHE = '([^']+)'/.exec(emitted.get('sw.js') ?? '')?.[1] ?? '';

    expect(name).toMatch(/^mossnote-1\.2\.3-[0-9a-f]{12}$/);
  });
});
