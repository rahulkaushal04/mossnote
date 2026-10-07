import { Hono } from 'hono';
import {
  personCreateSchema,
  personListQuerySchema,
  personPatchSchema,
} from '@shared/schemas/person';
import { backlinkQuerySchema } from '@shared/schemas/misc';
import type { Env } from '../env';
import { validateId, validateJson, validateQuery } from '../middleware/validate';
import type { Ctx } from '../services/ctx';
import { listBacklinks } from '../services/notes';
import {
  createPerson,
  deletePerson,
  getPerson,
  listPeople,
  patchPerson,
  restorePerson,
} from '../services/people';

export const peopleRoutes = (ctx: Ctx) =>
  new Hono<Env>()
    .get('/', validateQuery(personListQuerySchema), (c) =>
      c.json(listPeople(ctx, c.req.valid('query'))),
    )
    .post('/', validateJson(personCreateSchema), (c) => {
      const { person, created } = createPerson(ctx, c.req.valid('json'));
      return c.json(person, created ? 201 : 200);
    })
    .get('/:id', validateId, (c) => c.json(getPerson(ctx, c.req.valid('param').id)))
    .patch('/:id', validateId, validateJson(personPatchSchema), (c) =>
      c.json(patchPerson(ctx, c.req.valid('param').id, c.req.valid('json'))),
    )
    .delete('/:id', validateId, (c) => {
      deletePerson(ctx, c.req.valid('param').id);
      return c.body(null, 204);
    })
    .post('/:id/restore', validateId, (c) => c.json(restorePerson(ctx, c.req.valid('param').id)))
    .get('/:id/notes', validateId, validateQuery(backlinkQuerySchema), (c) => {
      const id = c.req.valid('param').id;
      getPerson(ctx, id);
      return c.json(listBacklinks(ctx, 'person', id, c.req.valid('query')));
    });
