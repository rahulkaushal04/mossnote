import { Hono } from 'hono';
import type { Env } from '../env';
import type { Ctx } from '../services/ctx';
import { schemaVersion } from '../services/health';

export const healthRoutes = (ctx: Ctx) =>
  new Hono<Env>().get('/', (c) =>
    c.json({
      ok: true as const,
      version: ctx.config.version,
      schemaVersion: ctx.attached ? schemaVersion(ctx.sqlite) : 0,
      /** The id of the open journal, or null on a first run. */
      journal: ctx.attached ? ctx.config.journal : null,
    }),
  );
