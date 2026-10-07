import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../env';

/** Written into index.html by Vite; replaced per response. */
export const NONCE_PLACEHOLDER = '__CSP_NONCE__';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves the built web app with SPA fallback to index.html for non-/api paths.
 * Hashed files under /assets/ are immutable; everything else is revalidated. A request for a
 * missing file with an extension is a 404, not index.html.
 */
export function serveWeb(root: string): MiddlewareHandler<Env> {
  const base = path.resolve(root);
  const indexFile = path.join(base, 'index.html');

  /** The HTML document: a fresh nonce goes into the meta tag the app reads, and into the CSP. */
  const respondDocument = (c: Context<Env>, method: string): Response => {
    const nonce = randomBytes(16).toString('base64');
    c.set('cspNonce', nonce);
    const html = fs.readFileSync(indexFile, 'utf8').replaceAll(NONCE_PLACEHOLDER, nonce);
    const body = Buffer.from(html, 'utf8');
    return new Response(method === 'HEAD' ? null : body, {
      headers: {
        'Content-Type': TYPES['.html'] ?? 'text/html; charset=utf-8',
        'Content-Length': String(body.length),
        'Cache-Control': 'no-cache',
      },
    });
  };

  const respond = (file: string, method: string): Response => {
    const body = fs.readFileSync(file);
    const hashed = file.startsWith(path.join(base, 'assets') + path.sep);
    return new Response(method === 'HEAD' ? null : body, {
      headers: {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': String(body.length),
        'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    });
  };

  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    const urlPath = new URL(c.req.url).pathname;
    if ((method !== 'GET' && method !== 'HEAD') || urlPath.startsWith('/api')) return next();

    let decoded: string;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return c.text('Not found.', 404);
    }
    const candidate = path.resolve(base, `.${decoded}`);
    // Path traversal guard: the resolved path must stay inside the web root.
    if (candidate !== base && !candidate.startsWith(base + path.sep)) {
      return c.text('Not found.', 404);
    }
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate === indexFile ? respondDocument(c, method) : respond(candidate, method);
    }
    if (path.extname(decoded) !== '') return c.text('Not found.', 404);
    if (fs.existsSync(indexFile)) return respondDocument(c, method);
    return next();
  };
}
