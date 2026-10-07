import { Hono } from 'hono';
import { settingsPatchSchema } from '@shared/schemas/settings';
import type { Env } from '../env';
import { validateJson } from '../middleware/validate';
import type { Ctx } from '../services/ctx';
import { reindexAll } from '../services/search-index';
import { getSettings, updateSettings } from '../services/settings';

export const settingsRoutes = (ctx: Ctx) =>
  new Hono<Env>()
    .get('/', (c) => c.json(getSettings(ctx, ctx.config.journal, ctx.clock)))
    .patch('/', validateJson(settingsPatchSchema), (c) =>
      c.json(
        updateSettings(ctx, ctx.config.journal, ctx.clock, c.req.valid('json'), () => {
          reindexAll(ctx);
        }),
      ),
    );
