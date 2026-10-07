import { z } from 'zod';
import { LIMITS } from '../constants';
import {
  boundedText,
  customFieldsSchema,
  isoTimestamp,
  smallListLimit,
  nameSchema,
  tagNamesSchema,
  ulidSchema,
} from './common';

const base = {
  name: nameSchema(LIMITS.personName),
  notes: boundedText(LIMITS.personNotes),
  progress: z.number().int().min(0).nullable(),
  progressMax: z
    .number()
    .int()
    .min(1, 'The maximum can be 1 to 99.')
    .max(LIMITS.progressMax, 'The maximum can be 1 to 99.')
    .nullable(),
  customFields: customFieldsSchema,
  tags: tagNamesSchema,
};

export const personCreateSchema = z
  .object({
    id: ulidSchema.optional(),
    name: base.name,
    notes: base.notes.optional(),
    progress: base.progress.optional(),
    progressMax: base.progressMax.optional(),
    customFields: base.customFields.optional(),
    tags: base.tags.optional(),
  })
  .strict();

export const personPatchSchema = z
  .object({
    name: base.name.optional(),
    notes: base.notes.optional(),
    progress: base.progress.optional(),
    progressMax: base.progressMax.optional(),
    customFields: base.customFields.optional(),
    tags: base.tags.optional(),
    expectedUpdatedAt: isoTimestamp.optional(),
  })
  .strict();

export const personListQuerySchema = z.object({
  tag: z.string().optional(),
  sort: z.enum(['name', 'updated']).default('name'),
  limit: smallListLimit,
  cursor: z.string().max(500).optional(),
});

export type PersonCreate = z.infer<typeof personCreateSchema>;
export type PersonPatch = z.infer<typeof personPatchSchema>;
export type PersonListQuery = z.infer<typeof personListQuerySchema>;
