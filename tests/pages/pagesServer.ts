import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

/**
 * A small static file server that answers the way GitHub Pages does for a project site, so the
 * published web version can be tested before it is published:
 *  - the site is served only under its base path (`/mossnote/`); anything outside it is a plain 404;
 *  - `/mossnote` and `/mossnote/docs` get a redirect to the same address with a trailing slash;
 *  - a folder answers with its `index.html`;
 *  - an address with no file behind it is a 404 whose page is the site's own `404.html`.
 * It sends no CORS or security headers and no `Cross-Origin-*` isolation, as Pages does not.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const HTML = 'text/html; charset=utf-8';

export interface PagesSite {
  /** `http://127.0.0.1:<port>`, with no path. */
  origin: string;
  /** Where the site lives on that origin, with slashes on both ends: `/mossnote/`. */
  base: string;
  close(): Promise<void>;
}

/** The base path a build was made for, from its manifest. */
export function baseOf(dist: string): string {
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8')) as {
    scope: string;
  };
  return manifest.scope;
}

export async function servePages(dist: string): Promise<PagesSite> {
  const base = baseOf(dist);
  const root = path.resolve(dist);
  const notFoundPage = fs.readFileSync(path.join(root, '404.html'));

  const server = http.createServer((request, response) => {
    const send = (status: number, type: string, body: Buffer | string, extra = {}) => {
      response.writeHead(status, {
        'content-type': type,
        'cache-control': 'max-age=600',
        ...extra,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(405, 'text/plain', 'Method not allowed');
      return;
    }

    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      send(400, 'text/plain', 'Bad request');
      return;
    }

    // `/mossnote` is the site, `/` is some other site that does not exist.
    if (decoded === base.slice(0, -1)) {
      send(301, 'text/plain', '', { location: base });
      return;
    }
    if (!decoded.startsWith(base)) {
      send(
        404,
        'text/html; charset=utf-8',
        '<h1>404</h1><p>There isn’t a GitHub Pages site here.</p>',
      );
      return;
    }

    const file = path.resolve(root, decoded.slice(base.length));
    if (file !== root && !file.startsWith(root + path.sep)) {
      send(404, 'text/plain', 'Not found');
      return;
    }
    const kind = fs.existsSync(file) ? fs.statSync(file) : null;
    if (kind?.isDirectory()) {
      if (!decoded.endsWith('/')) {
        send(301, 'text/plain', '', { location: `${decoded}/` });
        return;
      }
      const index = path.join(file, 'index.html');
      if (fs.existsSync(index)) {
        send(200, HTML, fs.readFileSync(index));
        return;
      }
    } else if (kind?.isFile()) {
      send(200, TYPES[path.extname(file)] ?? 'application/octet-stream', fs.readFileSync(file));
      return;
    }
    send(404, HTML, notFoundPage);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    base,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
