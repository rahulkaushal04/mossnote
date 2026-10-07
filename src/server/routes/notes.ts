import { Hono } from 'hono';
import {
  noteCreateSchema,
  noteFilterSchema,
  noteListQuerySchema,
  notePatchSchema,
} from '@shared/schemas/note';
import type { Env } from '../env';
import { validateId, validateJson, validateQuery } from '../middleware/validate';
import type { Ctx } from '../services/ctx';
import {
  countNotes,
  createNote,
  deleteNote,
  getNote,
  listNotes,
  patchNote,
  restoreNote,
} from '../services/notes';

export const noteRoutes = (ctx: Ctx) =>
  new Hono<Env>()
    .get('/', validateQuery(noteListQuerySchema), (c) =>
      c.json(listNotes(ctx, c.req.valid('query'))),
    )
    .get('/count', validateQuery(noteFilterSchema), (c) =>
      c.json({ count: countNotes(ctx, c.req.valid('query')) }),
    )
    .post('/', validateJson(noteCreateSchema), (c) => {
      const { note, created } = createNote(ctx, c.req.valid('json'));
      return c.json(note, created ? 201 : 200);
    })
    .get('/:id', validateId, (c) => c.json(getNote(ctx, c.req.valid('param').id)))
    .patch('/:id', validateId, validateJson(notePatchSchema), (c) =>
      c.json(patchNote(ctx, c.req.valid('param').id, c.req.valid('json'))),
    )
    .delete('/:id', validateId, (c) => {
      deleteNote(ctx, c.req.valid('param').id);
      return c.body(null, 204);
    })
    .post('/:id/restore', validateId, (c) => c.json(restoreNote(ctx, c.req.valid('param').id)));
