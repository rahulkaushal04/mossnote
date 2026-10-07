import { Hono } from 'hono';
import { fieldLabelsQuerySchema } from '@shared/schemas/misc';
import type { Env } from '../env';
import { validateQuery } from '../middleware/validate';
import type { Ctx } from '../services/ctx';
import { fieldLabels } from '../services/plantings';

export const fieldLabelRoutes = (ctx: Ctx) =>
  new Hono<Env>().get('/', validateQuery(fieldLabelsQuerySchema), (c) => {
    const { kind, q } = c.req.valid('query');
    return c.json({ labels: fieldLabels(ctx, kind, q) });
  });
