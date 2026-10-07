import { Hono } from 'hono';
import {
  plantingCreateSchema,
  plantingListQuerySchema,
  plantingPatchSchema,
} from '@shared/schemas/planting';
import { backlinkQuerySchema } from '@shared/schemas/misc';
import type { Env } from '../env';
import { validateId, validateJson, validateQuery } from '../middleware/validate';
import type { Ctx } from '../services/ctx';
import { listBacklinks } from '../services/notes';
import {
  createPlanting,
  deletePlanting,
  getPlanting,
  listPlantings,
  patchPlanting,
  restorePlanting,
} from '../services/plantings';

export const plantingRoutes = (ctx: Ctx) =>
  new Hono<Env>()
    .get('/', validateQuery(plantingListQuerySchema), (c) =>
      c.json(listPlantings(ctx, c.req.valid('query'))),
    )
    .post('/', validateJson(plantingCreateSchema), (c) => {
      const { planting, created } = createPlanting(ctx, c.req.valid('json'));
      return c.json(planting, created ? 201 : 200);
    })
    .get('/:id', validateId, (c) => c.json(getPlanting(ctx, c.req.valid('param').id)))
    .patch('/:id', validateId, validateJson(plantingPatchSchema), (c) =>
      c.json(patchPlanting(ctx, c.req.valid('param').id, c.req.valid('json'))),
    )
    .delete('/:id', validateId, (c) => {
      deletePlanting(ctx, c.req.valid('param').id);
      return c.body(null, 204);
    })
    .post('/:id/restore', validateId, (c) => c.json(restorePlanting(ctx, c.req.valid('param').id)))
    .get('/:id/notes', validateId, validateQuery(backlinkQuerySchema), (c) => {
      const id = c.req.valid('param').id;
      getPlanting(ctx, id);
      return c.json(listBacklinks(ctx, 'planting', id, c.req.valid('query')));
    });
