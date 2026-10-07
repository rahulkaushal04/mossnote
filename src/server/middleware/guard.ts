import type { MiddlewareHandler } from 'hono';
import { AppError } from '../errors';

export interface GuardOptions {
  port: number;
  /** Also accept the Vite dev server origin (`npm run dev`). */
  dev: boolean;
}

export const CLIENT_HEADER = 'x-moss-client';
export const CLIENT_VALUE = 'web';

/** Host values accepted on every request, lowercase. */
export function allowedHosts({ port, dev }: GuardOptions): Set<string> {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  if (dev) hosts.push('localhost:5173', '127.0.0.1:5173');
  return new Set(hosts);
}

const forbidden = (message: string) => new AppError('forbidden', message);

/**
 * The request guard:
 *  1. The Host header must be on the allow-list, on every request including GET and HEAD
 *     (blocks DNS rebinding).
 *  2. OPTIONS is always refused: the server sends no CORS headers, so preflights must fail.
 *  3. When an Origin header is present it must equal this app's own origin.
 *  4. Anything other than GET or HEAD must send `Content-Type: application/json` and
 *     `X-Moss-Client: web`, both of which force a preflight from other web pages.
 */
export function guard(options: GuardOptions): MiddlewareHandler {
  const hosts = allowedHosts(options);

  return async (c, next) => {
    const host = c.req.header('host')?.toLowerCase();
    if (!host || !hosts.has(host)) throw forbidden('This request was refused.');

    const method = c.req.method.toUpperCase();
    if (method === 'OPTIONS') throw forbidden('This request was refused.');

    const origin = c.req.header('origin');
    if (origin !== undefined && origin.toLowerCase() !== `http://${host}`) {
      throw forbidden('This request was refused.');
    }

    if (method !== 'GET' && method !== 'HEAD') {
      const type = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (type !== 'application/json') throw forbidden('This request was refused.');
      if (c.req.header(CLIENT_HEADER) !== CLIENT_VALUE)
        throw forbidden('This request was refused.');
    }

    await next();
  };
}
