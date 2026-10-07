import { Hono } from 'hono';
import { pickQuerySchema, searchQuerySchema } from '@shared/schemas/misc';
import type { Env } from '../env';
import { validateQuery } from '../middleware/validate';
import type { Ctx } from '../services/ctx';
import { pick } from '../services/pick';
import { search, type SearchKind } from '../services/search';

const KIND_NAMES: Record<string, SearchKind> = {
  note: 'note',
  notes: 'note',
  person: 'person',
  people: 'person',
  planting: 'planting',
  plantings: 'planting',
  farm: 'planting',
  tag: 'tag',
  tags: 'tag',
  map: 'map',
  maps: 'map',
};

export const searchRoutes = (ctx: Ctx) =>
  new Hono<Env>().get('/', validateQuery(searchQuerySchema), (c) => {
    const { q, kinds, limit } = c.req.valid('query');
    const parsed = kinds
      ?.split(',')
      .map((k) => KIND_NAMES[k.trim()])
      .filter((k): k is SearchKind => k !== undefined);
    return c.json(
      search(ctx, { q, kinds: parsed && parsed.length > 0 ? parsed : undefined, limit }),
    );
  });

export const pickRoutes = (ctx: Ctx) =>
  new Hono<Env>().get('/', validateQuery(pickQuerySchema), (c) => {
    const { kind, q, limit, exclude } = c.req.valid('query');
    return c.json({
      items: pick(ctx, {
        kind,
        q,
        limit,
        exclude: exclude ? exclude.split(',').filter(Boolean) : [],
      }),
    });
  });
