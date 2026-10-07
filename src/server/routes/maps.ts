import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { ulidSchema } from '@shared/schemas/common';
import {
  mapChangesSchema,
  mapCreateSchema,
  mapDuplicateSchema,
  mapListQuerySchema,
  mapProjectSchema,
  mapPatchSchema,
  pinCreateSchema,
  pinPatchSchema,
  pinsByTargetQuerySchema,
  versionCreateSchema,
} from '@shared/schemas/map';
import type { Env } from '../env';
import { fromZod } from '../middleware/errors';
import { validateId, validateJson, validateQuery } from '../middleware/validate';
import type { Ctx } from '../services/ctx';
import {
  applyChanges,
  createMap,
  createPin,
  deleteMap,
  deletePin,
  deleteVersion,
  duplicateMap,
  exportMapProject,
  importMapProject,
  listVersions,
  restoreVersion,
  saveVersion,
  getMap,
  listMaps,
  listPlaces,
  patchMap,
  patchPin,
  pinsPointingAt,
  restoreMap,
} from '../services/maps';

const versionParams = zValidator(
  'param',
  z.object({ id: ulidSchema, versionId: ulidSchema }),
  (r) => {
    if (!r.success) throw fromZod(r.error);
  },
);

const pinParams = zValidator('param', z.object({ id: ulidSchema, pinId: ulidSchema }), (r) => {
  if (!r.success) throw fromZod(r.error);
});

/** A safe file name from a map name. */
const fileName = (name: string): string =>
  name
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .trim()
    .slice(0, 60) || 'map';

export const mapRoutes = (ctx: Ctx) =>
  new Hono<Env>()
    .get('/', validateQuery(mapListQuerySchema), (c) => c.json(listMaps(ctx, c.req.valid('query'))))
    .post('/', validateJson(mapCreateSchema), (c) => {
      const { map, created } = createMap(ctx, c.req.valid('json'));
      return c.json(map, created ? 201 : 200);
    })
    .post('/import', validateJson(mapProjectSchema), (c) =>
      c.json(importMapProject(ctx, c.req.valid('json')), 201),
    )
    .get('/places', (c) => c.json({ items: listPlaces(ctx) }))
    .get('/pins', validateQuery(pinsByTargetQuerySchema), (c) => {
      const { type, id } = c.req.valid('query');
      return c.json({ items: pinsPointingAt(ctx, type, id) });
    })
    .get('/:id', validateId, (c) => c.json(getMap(ctx, c.req.valid('param').id)))
    .patch('/:id', validateId, validateJson(mapPatchSchema), (c) =>
      c.json(patchMap(ctx, c.req.valid('param').id, c.req.valid('json'))),
    )
    .delete('/:id', validateId, (c) => {
      deleteMap(ctx, c.req.valid('param').id);
      return c.body(null, 204);
    })
    .post('/:id/restore', validateId, (c) => c.json(restoreMap(ctx, c.req.valid('param').id)))
    .post('/:id/changes', validateId, validateJson(mapChangesSchema), (c) =>
      c.json(applyChanges(ctx, c.req.valid('param').id, c.req.valid('json'))),
    )
    .post('/:id/duplicate', validateId, validateJson(mapDuplicateSchema), (c) =>
      c.json(duplicateMap(ctx, c.req.valid('param').id, c.req.valid('json')), 201),
    )
    .get('/:id/export.json', validateId, (c) => {
      const map = exportMapProject(ctx, c.req.valid('param').id);
      c.header('Content-Disposition', `attachment; filename="${fileName(map.name)}.mossmap.json"`);
      return c.body(`${JSON.stringify(map, null, 2)}\n`, 200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
    })
    .get('/:id/versions', validateId, (c) =>
      c.json({ items: listVersions(ctx, c.req.valid('param').id) }),
    )
    .post('/:id/versions', validateId, validateJson(versionCreateSchema), (c) =>
      c.json({ items: saveVersion(ctx, c.req.valid('param').id, c.req.valid('json').name) }, 201),
    )
    .post('/:id/versions/:versionId/restore', versionParams, (c) => {
      const { id, versionId } = c.req.valid('param');
      return c.json(restoreVersion(ctx, id, versionId));
    })
    .delete('/:id/versions/:versionId', versionParams, (c) => {
      const { id, versionId } = c.req.valid('param');
      deleteVersion(ctx, id, versionId);
      return c.body(null, 204);
    })
    .post('/:id/pins', validateId, validateJson(pinCreateSchema), (c) => {
      const { pin, created } = createPin(ctx, c.req.valid('param').id, c.req.valid('json'));
      return c.json(pin, created ? 201 : 200);
    })
    .patch('/:id/pins/:pinId', pinParams, validateJson(pinPatchSchema), (c) => {
      const { id, pinId } = c.req.valid('param');
      return c.json(patchPin(ctx, id, pinId, c.req.valid('json')));
    })
    .delete('/:id/pins/:pinId', pinParams, (c) => {
      const { id, pinId } = c.req.valid('param');
      deletePin(ctx, id, pinId);
      return c.body(null, 204);
    });
