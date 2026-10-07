import { Hono } from 'hono';
import { tagCreateSchema, tagMergeSchema, tagPatchSchema } from '@shared/schemas/misc';
import type { Env } from '../env';
import { validateId, validateJson } from '../middleware/validate';
import type { Ctx } from '../services/ctx';
import { createTag, deleteTag, listTags, mergeTag, updateTag } from '../services/tags';

export const tagRoutes = (ctx: Ctx) =>
  new Hono<Env>()
    .get('/', (c) => c.json(listTags(ctx)))
    .post('/', validateJson(tagCreateSchema), (c) =>
      c.json(createTag(ctx, c.req.valid('json').name)),
    )
    .patch('/:id', validateId, validateJson(tagPatchSchema), (c) =>
      c.json(updateTag(ctx, c.req.valid('param').id, c.req.valid('json'))),
    )
    .post('/:id/merge', validateId, validateJson(tagMergeSchema), (c) =>
      c.json(mergeTag(ctx, c.req.valid('param').id, c.req.valid('json').intoId)),
    )
    .delete('/:id', validateId, (c) => {
      deleteTag(ctx, c.req.valid('param').id);
      return c.body(null, 204);
    });
