import { z } from 'zod';
import { calendarSchema } from './calendar';
import { layoutSchema } from './layout';
import { markerTypesSchema } from './map';

export const readingSizeSchema = z.enum(['comfortable', 'large']);

export const prefsSchema = z
  .object({
    readingSize: readingSizeSchema,
    hintDismissed: z.boolean(),
  })
  .strict();

export const metaSchema = z
  .object({
    createdAt: z.number().int(),
    journalName: z.string().min(1),
  })
  .strict();

/** Game date key or null. Validity against the calendar is checked in the service. */
export const currentGameDateSchema = z.number().int().nonnegative().nullable();

/** `GET /api/settings` response. */
export const settingsSchema = z
  .object({
    calendar: calendarSchema,
    currentGameDate: currentGameDateSchema,
    prefs: prefsSchema,
    layout: layoutSchema,
    markerTypes: markerTypesSchema,
    meta: metaSchema,
  })
  .strict();

/** `PATCH /api/settings` body. Unknown fields are rejected. `prefs` is merged field by field. */
export const settingsPatchSchema = z
  .object({
    calendar: calendarSchema.optional(),
    currentGameDate: currentGameDateSchema.optional(),
    prefs: prefsSchema.partial().strict().optional(),
    layout: layoutSchema.optional(),
    markerTypes: markerTypesSchema.optional(),
  })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export type Prefs = z.infer<typeof prefsSchema>;
