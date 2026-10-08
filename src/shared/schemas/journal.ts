import { z } from 'zod';
import { isTemplateId } from '../templates';

/** A journal's name as people see it. The file name is derived from it once, then never changes. */
export const journalNameSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1 && s.length <= 60, 'Names need 1 to 60 characters.');

/** `POST /api/journals`. */
export const journalCreateSchema = z
  .object({
    name: journalNameSchema,
    template: z.string().refine(isTemplateId, 'Choose one of the listed templates.'),
  })
  .strict();

/** `PATCH /api/journals/:id`. */
export const journalPatchSchema = z.object({ name: journalNameSchema }).strict();

/** `DELETE /api/journals/:id`: the name typed back, and whether to keep a last copy. */
export const journalDeleteSchema = z
  .object({
    confirmName: z.string().max(200),
    finalSnapshot: z.boolean(),
  })
  .strict();

export type JournalCreate = z.infer<typeof journalCreateSchema>;
export type JournalPatch = z.infer<typeof journalPatchSchema>;
export type JournalDelete = z.infer<typeof journalDeleteSchema>;
