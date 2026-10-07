import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';

/**
 * Production Content-Security-Policy (spec section 25). HTML documents add a per-response nonce to
 * `style-src` only: Radix's scroll lock injects a <style> element at runtime, which a bare
 * `style-src 'self'` blocks. Scripts never get a nonce, so inline scripts stay forbidden. Every
 * other response (API, assets) uses the policy without a nonce.
 */
export function buildCsp(nonce?: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    nonce ? `style-src 'self' 'nonce-${nonce}'` : "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The policy without a nonce: exactly the header block in spec section 25. */
export const CSP = buildCsp();

/**
 * Response headers from spec section 25. The CSP is relaxed (omitted) only in development, where
 * Vite's dev server needs inline scripts and websockets.
 */
export function securityHeaders(options: { dev: boolean }): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    if (!options.dev) h.set('Content-Security-Policy', buildCsp(c.get('cspNonce')));
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Referrer-Policy', 'no-referrer');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (new URL(c.req.url).pathname.startsWith('/api')) h.set('Cache-Control', 'no-store');
  };
}
