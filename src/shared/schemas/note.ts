import { z } from 'zod';
import { LIMITS } from '../constants';
import { cleanText } from '../text';
import {
  boundedText,
  gameDateKey,
  intFromQuery,
  isoTimestamp,
  limitSchema,
  linkInputSchema,
  queryFlag,
  tagNamesSchema,
  ulidSchema,
} from './common';

const titleSchema = z
  .string()
  .transform((s) => cleanText(s).trim())
  .refine((s) => s.length <= LIMITS.noteTitle, 'Titles can be up to 200 characters.')
  .transform((s) => (s === '' ? null : s));

const resolutionSchema = z
  .string()
  .transform(cleanText)
  .refine((s) => s.length <= LIMITS.resolution, 'Answers can be up to 2,000 characters.');

/** `question` as sent by the client. Solving is `{ state: 'solved', resolution?, solvedGameDate? }`. */
export const questionInputSchema = z
  .object({
    state: z.enum(['open', 'solved']),
    resolution: resolutionSchema.nullable().optional(),
    solvedGameDate: gameDateKey.nullable().optional(),
  })
  .strict();

const base = {
  title: titleSchema.nullable().optional(),
  body: boundedText(LIMITS.noteBody).optional(),
  gameDate: gameDateKey.nullable().optional(),
  isDiscovery: z.boolean().optional(),
  question: questionInputSchema.nullable().optional(),
  tags: tagNamesSchema.optional(),
  links: z.array(linkInputSchema).max(LIMITS.linksPerNote, "That link can't be added.").optional(),
};

export const noteCreateSchema = z.object({ id: ulidSchema.optional(), ...base }).strict();

export const notePatchSchema = z
  .object({ ...base, expectedUpdatedAt: isoTimestamp.optional() })
  .strict();

export type NoteCreate = z.infer<typeof noteCreateSchema>;
export type NotePatch = z.infer<typeof notePatchSchema>;
export type QuestionInput = z.infer<typeof questionInputSchema>;

const tagParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]));

/** Filters shared by `GET /api/notes` and `GET /api/notes/count`. */
export const noteFilterSchema = z.object({
  flag: z.enum(['discovery', 'question']).optional(),
  state: z.enum(['open', 'solved']).optional(),
  tag: tagParam,
  person: ulidSchema.optional(),
  planting: ulidSchema.optional(),
  gameDate: intFromQuery.optional(),
  from: intFromQuery.optional(),
  to: intFromQuery.optional(),
  undated: queryFlag.optional(),
  createdFrom: intFromQuery.optional(),
  createdTo: intFromQuery.optional(),
});

export const noteListQuerySchema = noteFilterSchema.extend({
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: limitSchema,
  cursor: z.string().max(500).optional(),
});

export type NoteFilter = z.infer<typeof noteFilterSchema>;
export type NoteListQuery = z.infer<typeof noteListQuerySchema>;
