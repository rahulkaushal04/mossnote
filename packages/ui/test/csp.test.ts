import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { CSP, CSP_META } from '../src/csp';

const root = fileURLToPath(new URL('..', import.meta.url));

// A real production build, so this fails if the plugin is not wired into the config.
describe('CSP meta in the built index.html (C3)', () => {
  it('equals the CSP constant and comes before any script', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mossnote-csp-'));
    try {
      await build({
        root,
        logLevel: 'silent',
        build: { outDir: out, emptyOutDir: true, write: true },
      });
      const html = readFileSync(join(out, 'index.html'), 'utf8');
      const metas = [
        ...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/g),
      ];
      expect(metas).toHaveLength(1);
      // Vite HTML-escapes attribute values; the browser decodes them back.
      const decoded = metas[0]![1]!.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      expect(decoded).toBe(CSP_META);
      expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);

  it('the meta policy omits frame-ancestors (ignored in meta) but is otherwise the header policy', () => {
    expect(CSP_META).not.toContain('frame-ancestors');
    expect(CSP.startsWith(CSP_META)).toBe(true);
    expect(CSP_META).toContain("script-src 'self'");
    expect(CSP_META).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('grants the attachment scheme to img-src and media-src and loosens nothing else', () => {
    const dirs = Object.fromEntries(
      CSP.split('; ').map((d) => [d.split(' ')[0]!, d.split(' ').slice(1).join(' ')]),
    );
    expect(dirs).toEqual({
      'default-src': "'none'",
      'script-src': "'self'",
      'style-src': "'self' 'unsafe-inline'",
      'img-src': "'self' data: mossnote-attachment:",
      'media-src': 'mossnote-attachment:',
      'font-src': "'self'",
      'connect-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'",
      'frame-ancestors': "'none'",
    });
    for (const bad of ['https:', 'http:', "'unsafe-eval'", 'frame-src', 'worker-src', '*'])
      expect(CSP).not.toContain(bad);
  });
});
