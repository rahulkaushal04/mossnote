import { z } from 'zod';
import { SECTION_IDS } from '../templates/types';

export const sectionIdSchema = z.enum(SECTION_IDS);

const label = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1 && s.length <= 30, 'Names need 1 to 30 characters.');

export const layoutSchema = z
  .object({
    template: z.string().min(1).max(40),
    order: z.array(sectionIdSchema).max(SECTION_IDS.length),
    hidden: z.array(sectionIdSchema).max(SECTION_IDS.length),
    labels: z.partialRecord(sectionIdSchema, label),
    quickActions: z.boolean(),
  })
  .strict();

export type LayoutInput = z.infer<typeof layoutSchema>;
