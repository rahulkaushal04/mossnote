import type { MiddlewareHandler } from 'hono';
import type { Logger } from '../logger';
import type { Env } from '../env';

/**
 * Assigns a short request id and logs one line per request: method, path (never the query
 * string, which can hold search text), status and duration.
 */
export function requestLog(logger: Logger): MiddlewareHandler<Env> {
  return async (c, next) => {
    const id = crypto.randomUUID().slice(0, 8);
    c.set('requestId', id);
    const started = performance.now();
    await next();
    logger.debug(`${c.req.method} ${new URL(c.req.url).pathname}`, {
      status: c.res.status,
      ms: Math.round(performance.now() - started),
      id,
    });
  };
}
