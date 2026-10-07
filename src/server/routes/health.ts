import { Hono } from 'hono';
import type { Env } from '../env';
import type { Ctx } from '../services/ctx';
import { schemaVersion } from '../services/health';

export const healthRoutes = (ctx: Ctx) =>
  new Hono<Env>().get('/', (c) =>
    c.json({
      ok: true as const,
      version: ctx.config.version,
      schemaVersion: schemaVersion(ctx.sqlite),
    }),
  );
