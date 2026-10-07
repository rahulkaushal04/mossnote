import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCsp, CSP } from './security-headers';
import { makeTestApp, TEST_HOST, type TestApp } from '../testing/app';
import { makeTempDir, removeDir } from '../testing/helpers';

let webRoot: string;
let t: TestApp;
beforeAll(async () => {
  webRoot = makeTempDir('moss-web-');
  fs.mkdirSync(path.join(webRoot, 'assets'));
  fs.writeFileSync(
    path.join(webRoot, 'index.html'),
    '<!doctype html><title>Mossnote</title><meta name="csp-nonce" content="__CSP_NONCE__">',
  );
  fs.writeFileSync(path.join(webRoot, 'theme-init.js'), '/* theme */');
  fs.writeFileSync(path.join(webRoot, 'assets', 'app-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(webRoot, 'assets', 'font-abc123.woff2'), 'font');
  fs.writeFileSync(path.join(path.dirname(webRoot), 'moss-secret.txt'), 'secret');
  t = await makeTestApp({ webRoot });
});
afterAll(() => {
  t.close();
  fs.rmSync(path.join(path.dirname(webRoot), 'moss-secret.txt'), { force: true });
  removeDir(webRoot);
});

const get = (p: string) => t.raw('GET', p, { headers: { host: TEST_HOST } });

describe('response headers (spec section 25)', () => {
  it('matches the specified Content-Security-Policy exactly', () => {
    expect(CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  });

  it('sets every header on API responses, with no-store', async () => {
    const h = (await get('/api/health')).headers;
    expect(h.get('content-security-policy')).toBe(CSP);
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('x-frame-options')).toBe('DENY');
    expect(h.get('referrer-policy')).toBe('no-referrer');
    expect(h.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(h.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(h.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
    expect(h.get('cache-control')).toBe('no-store');
  });

  it('sets the same headers on static files and errors, with the nonce-free policy', async () => {
    for (const p of ['/theme-init.js', '/assets/app-abc123.js', '/api/nope']) {
      const h = (await get(p)).headers;
      expect(h.get('content-security-policy'), p).toBe(CSP);
      expect(h.get('x-content-type-options'), p).toBe('nosniff');
    }
    const forbidden = await t.raw('GET', '/api/health', { headers: { host: 'evil.example' } });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get('content-security-policy')).toBe(CSP);
  });

  it('gives HTML documents a per-response style nonce, and nothing else changes', async () => {
    const seen = new Set<string>();
    for (const p of ['/', '/journal', '/day/10003', '/']) {
      const res = await get(p);
      const csp = res.headers.get('content-security-policy') ?? '';
      const nonce = /style-src 'self' 'nonce-([A-Za-z0-9+/=]{22,})'/.exec(csp)?.[1];
      expect(nonce, p).toBeTruthy();
      seen.add(nonce ?? '');
      // The only difference from the spec policy is the nonce on style-src.
      expect(csp).toBe(buildCsp(nonce));
      expect(csp.replace(` 'nonce-${nonce}'`, '')).toBe(CSP);
      expect(csp).not.toMatch(/script-src[^;]*nonce/);
      // The same nonce is handed to the app through the meta tag.
      const html = await res.text();
      expect(html).toContain(`<meta name="csp-nonce" content="${nonce}">`);
      expect(html).not.toContain('__CSP_NONCE__');
    }
    expect(seen.size).toBe(4);
  });

  it('gives HEAD requests for the document a nonce header too', async () => {
    const res = await t.raw('HEAD', '/', { headers: { host: TEST_HOST } });
    expect(res.headers.get('content-security-policy')).toMatch(/'nonce-/);
  });

  it('omits only the CSP in development', async () => {
    const dev = await makeTestApp({ config: { dev: true } });
    const h = (await dev.raw('GET', '/api/health', { headers: { host: TEST_HOST } })).headers;
    expect(h.get('content-security-policy')).toBeNull();
    expect(h.get('x-content-type-options')).toBe('nosniff');
    dev.close();
  });
});

describe('static serving', () => {
  it('serves index.html at / and falls back to it for app routes', async () => {
    for (const p of ['/', '/journal', '/day/10003', '/notes/abc']) {
      const res = await get(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('<title>Mossnote</title>');
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('serves hashed assets as immutable and other files revalidated', async () => {
    const asset = await get('/assets/app-abc123.js');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    const font = await get('/assets/font-abc123.woff2');
    expect(font.headers.get('content-type')).toBe('font/woff2');
    const theme = await get('/theme-init.js');
    expect(theme.headers.get('cache-control')).toBe('no-cache');
  });

  it('returns 404 for a missing file with an extension, not the app shell', async () => {
    const res = await get('/assets/missing.js');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Mossnote');
  });

  it('does not serve files outside the web root', async () => {
    for (const p of [
      '/..%2Fmoss-secret.txt',
      '/%2e%2e/moss-secret.txt',
      '/assets/..%2F..%2Fmoss-secret.txt',
    ]) {
      const res = await get(p);
      expect(await res.text(), p).not.toContain('secret');
    }
  });

  it('never serves the app shell for /api paths', async () => {
    const res = await get('/api/unknown');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('answers HEAD without a body', async () => {
    const res = await t.raw('HEAD', '/', { headers: { host: TEST_HOST } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});
