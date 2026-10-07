import { z } from 'zod';
import { LIMITS } from '../constants';
import {
  boundedText,
  customFieldsSchema,
  gameDateKey,
  isoTimestamp,
  smallListLimit,
  nameSchema,
  tagNamesSchema,
  ulidSchema,
} from './common';

const COUNT_MESSAGE = 'Use a whole number from 0 to 999,999.';
const count = z
  .number({ error: COUNT_MESSAGE })
  .int(COUNT_MESSAGE)
  .min(0, COUNT_MESSAGE)
  .max(LIMITS.count, COUNT_MESSAGE);

const base = {
  label: nameSchema(LIMITS.plantingLabel),
  plantedOn: gameDateKey.nullable(),
  harvestedOn: gameDateKey.nullable(),
  plantedCount: count.nullable(),
  harvestedCount: count.nullable(),
  notes: boundedText(LIMITS.plantingNotes),
  customFields: customFieldsSchema,
  tags: tagNamesSchema,
};

export const plantingCreateSchema = z
  .object({
    id: ulidSchema.optional(),
    label: base.label,
    plantedOn: base.plantedOn.optional(),
    harvestedOn: base.harvestedOn.optional(),
    plantedCount: base.plantedCount.optional(),
    harvestedCount: base.harvestedCount.optional(),
    notes: base.notes.optional(),
    customFields: base.customFields.optional(),
    tags: base.tags.optional(),
  })
  .strict();

export const plantingPatchSchema = z
  .object({
    label: base.label.optional(),
    plantedOn: base.plantedOn.optional(),
    harvestedOn: base.harvestedOn.optional(),
    plantedCount: base.plantedCount.optional(),
    harvestedCount: base.harvestedCount.optional(),
    notes: base.notes.optional(),
    customFields: base.customFields.optional(),
    tags: base.tags.optional(),
    expectedUpdatedAt: isoTimestamp.optional(),
  })
  .strict();

export const plantingListQuerySchema = z.object({
  status: z.enum(['growing', 'done', 'noted']).optional(),
  tag: z.string().optional(),
  limit: smallListLimit,
  cursor: z.string().max(500).optional(),
});

export type PlantingCreate = z.infer<typeof plantingCreateSchema>;
export type PlantingPatch = z.infer<typeof plantingPatchSchema>;
export type PlantingListQuery = z.infer<typeof plantingListQuerySchema>;
