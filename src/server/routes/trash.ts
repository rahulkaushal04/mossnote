import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { ulidSchema } from '@shared/schemas/common';
import { trashQuerySchema } from '@shared/schemas/misc';
import type { Env } from '../env';
import { fromZod } from '../middleware/errors';
import { validateQuery } from '../middleware/validate';
import type { Ctx } from '../services/ctx';
import { deleteForever, emptyTrash, listTrash, restoreFromTrash } from '../services/trash';

const target = z.object({ kind: z.enum(['note', 'person', 'planting', 'map']), id: ulidSchema });
const validateTarget = zValidator('param', target, (result) => {
  if (!result.success) throw fromZod(result.error);
});

export const trashRoutes = (ctx: Ctx) =>
  new Hono<Env>()
    .get('/', validateQuery(trashQuerySchema), (c) =>
      c.json({ items: listTrash(ctx, c.req.valid('query').kind) }),
    )
    .post('/:kind/:id/restore', validateTarget, (c) => {
      const { kind, id } = c.req.valid('param');
      return c.json(restoreFromTrash(ctx, kind, id));
    })
    .delete('/:kind/:id', validateTarget, (c) => {
      const { kind, id } = c.req.valid('param');
      deleteForever(ctx, kind, id);
      return c.body(null, 204);
    })
    .delete('/', (c) => c.json({ removed: emptyTrash(ctx) }));
