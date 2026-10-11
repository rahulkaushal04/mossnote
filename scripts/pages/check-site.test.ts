import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../../src/server/testing/helpers';
import { builtBase, checkSite, normalizeBase } from './check-site';

let dist: string;
beforeEach(() => {
  dist = makeTempDir('moss-pages-');
});
afterEach(() => {
  removeDir(dist);
});

const write = (name: string, text: string) => {
  const file = path.join(dist, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

/** A small web version built for `base`, shaped like the real build's output. */
function site(base: string, overrides: Record<string, string> = {}) {
  const page = `<!doctype html><html><head>
<link rel="icon" href="${base}favicon.svg" />
<script type="module" src="${base}assets/app.js"></script>
<link rel="stylesheet" href="${base}assets/app.css" />
<link rel="manifest" href="${base}manifest.webmanifest" />
</head><body><div id="root"></div></body></html>`;
  const manifest = JSON.stringify({
    start_url: base,
    scope: base,
    icons: [{ src: `${base}icon-192.png` }],
  });
  const kept = JSON.stringify([base, `${base}index.html`, `${base}assets/app.js`]);
  const files: Record<string, string> = {
    'index.html': page,
    '404.html': page,
    'manifest.webmanifest': manifest,
    'assets/app.js': 'export {}',
    'assets/app.css': `@font-face{src:url(${base}assets/f.woff2)}`,
    'sw.js': `const FILES = JSON.parse('${kept}');`,
    ...overrides,
  };
  for (const [name, text] of Object.entries(files)) write(name, text);
}

describe('normalizeBase', () => {
  it('gives every form of the base path a leading and a trailing slash', () => {
    expect(normalizeBase('mossnote')).toBe('/mossnote/');
    expect(normalizeBase('/mossnote')).toBe('/mossnote/');
    expect(normalizeBase('/mossnote/')).toBe('/mossnote/');
    expect(normalizeBase('/')).toBe('/');
  });
});

describe('checkSite', () => {
  it('accepts a build made for a project site, and for the root', () => {
    site('/mossnote/');
    expect(builtBase(dist)).toBe('/mossnote/');
    expect(checkSite(dist)).toEqual([]);
    expect(checkSite(dist, '/mossnote/')).toEqual([]);
    removeDir(dist);
    dist = makeTempDir('moss-pages-');
    site('/');
    expect(checkSite(dist, '/')).toEqual([]);
  });

  it('refuses a build made for a different base path than the one it will be served at', () => {
    site('/');
    const problems = checkSite(dist, '/mossnote/');
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('MOSS_BASE=/mossnote/');
  });

  it('finds an address in the page or the stylesheet that skips the base path', () => {
    site('/mossnote/', {
      'index.html': '<script src="/assets/app.js"></script><img src="//cdn.example/x.png">',
      'assets/app.css': 'a{background:url(/assets/x.png)}',
    });
    const messages = checkSite(dist).map((p) => `${p.file} ${p.message}`);
    expect(messages).toContain('index.html uses "/assets/app.js", which is outside "/mossnote/".');
    expect(messages).toContain(
      'assets/app.css uses "/assets/x.png", which is outside "/mossnote/".',
    );
    // A protocol-relative address is another site, not a path on this one.
    expect(messages.join('\n')).not.toContain('cdn.example');
  });

  it('wants 404.html to be the app, so a refresh on a deep link opens it', () => {
    site('/mossnote/', { '404.html': '<h1>Not found</h1>' });
    expect(checkSite(dist).map((p) => p.file)).toContain('404.html');
    fs.rmSync(path.join(dist, '404.html'));
    expect(
      checkSite(dist)
        .map((p) => p.message)
        .join(' '),
    ).toContain('is missing');
  });

  it('finds a file the service worker would try to keep that is not in the build', () => {
    const kept = JSON.stringify(['/mossnote/', '/mossnote/index.html', '/mossnote/assets/gone.js']);
    site('/mossnote/', { 'sw.js': `const FILES = JSON.parse('${kept}');` });
    const messages = checkSite(dist).map((p) => p.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('assets/gone.js');
  });

  it('refuses a folder that is not the web version at all', () => {
    expect(checkSite(dist)[0]?.file).toBe('manifest.webmanifest');
  });
});
