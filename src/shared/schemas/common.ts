import { z } from 'zod';
import { LIMITS, ULID_PATTERN } from '../constants';
import { cleanText, formatCount } from '../text';

export const ulidSchema = z.string().regex(ULID_PATTERN, 'That id is not valid.');

/** Text with CRLF and NUL normalised and a length limit that reports the count. */
export function boundedText(max: number) {
  return z
    .string()
    .transform(cleanText)
    .superRefine((value, ctx) => {
      if (value.length > max) {
        ctx.addIssue({
          code: 'custom',
          message: `Too long: ${formatCount(value.length)} of ${formatCount(max)} characters.`,
        });
      }
    });
}

/** A trimmed name of 1 to `max` characters. */
export function nameSchema(max: number) {
  return z
    .string()
    .transform((s) => cleanText(s).trim())
    .refine((s) => s.length > 0, 'Add a name.')
    .refine((s) => s.length <= max, `Names can be up to ${max} characters.`);
}

export const gameDateKey = z.number().int().nonnegative();

export const isoTimestamp = z.iso.datetime({ message: 'Use an ISO 8601 date and time.' });

export const customFieldSchema = z
  .object({
    label: z
      .string()
      .transform((s) => cleanText(s).trim())
      .refine(
        (s) => s.length >= 1 && s.length <= LIMITS.customFieldLabel,
        'Labels need 1 to 40 characters.',
      ),
    value: z
      .string()
      .transform(cleanText)
      .refine(
        (s) => s.length <= LIMITS.customFieldValue,
        `Values can be up to ${LIMITS.customFieldValue} characters.`,
      ),
  })
  .strict();

export const customFieldsSchema = z
  .array(customFieldSchema)
  .max(LIMITS.customFields, 'You can add up to 30 fields.')
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      const key = field.label.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'label'],
          message: 'That label is already used here.',
        });
      }
      seen.add(key);
    });
  });

export const tagNamesSchema = z.array(z.string().max(200)).max(100);

export const linkInputSchema = z
  .object({ type: z.enum(['note', 'person', 'planting']), id: ulidSchema })
  .strict();

/** Query booleans arrive as strings. */
export const queryFlag = z
  .enum(['1', '0', 'true', 'false'])
  .transform((v) => v === '1' || v === 'true');

export const limitSchema = z.coerce.number().int().min(1).max(100).default(50);
/** People and farm lists are small; they page only beyond 500. */
export const smallListLimit = z.coerce.number().int().min(1).max(500).default(500);
export const intFromQuery = z.coerce.number().int();
