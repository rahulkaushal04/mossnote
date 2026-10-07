import { z } from 'zod';
import { LIMITS } from '../constants';
import { limitSchema, ulidSchema } from './common';

export const tagCreateSchema = z.object({ name: z.string().max(200) }).strict();
export const tagPatchSchema = z
  .object({ name: z.string().max(200).optional(), pinned: z.boolean().optional() })
  .strict();
export const tagMergeSchema = z.object({ intoId: ulidSchema }).strict();

export const backlinkQuerySchema = z.object({
  limit: limitSchema,
  cursor: z.string().max(500).optional(),
});

export const fieldLabelsQuerySchema = z.object({
  kind: z.enum(['person', 'planting']),
  q: z.string().max(100).default(''),
});

export const searchQuerySchema = z.object({
  q: z.string().max(1000).default(''),
  kinds: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const pickQuerySchema = z.object({
  kind: z.enum(['tag', 'person', 'note', 'planting', 'any']),
  q: z.string().max(LIMITS.searchQuery).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(8),
  exclude: z.string().max(2000).optional(),
});

export const trashQuerySchema = z.object({
  kind: z.enum(['note', 'person', 'planting', 'map']).optional(),
});

export const importQuerySchema = z.object({
  dryRun: z.enum(['1', '0', 'true', 'false']).optional(),
});
