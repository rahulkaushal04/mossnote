import { z } from 'zod';
import { COUNTER_CALENDAR, LIMITS } from '../constants';

export const seasonSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Season names need 1 to 20 characters.')
      .max(LIMITS.seasonName, 'Season names need 1 to 20 characters.'),
    days: z
      .number()
      .int('Days must be a whole number from 1 to 99.')
      .min(1, 'Days must be a whole number from 1 to 99.')
      .max(LIMITS.daysPerSeasonMax, 'Days must be a whole number from 1 to 99.'),
  })
  .strict();

export const calendarSchema = z
  .object({
    seasons: z.array(seasonSchema).min(LIMITS.seasonsMin).max(LIMITS.seasonsMax),
    counter: z.literal(true).optional(),
  })
  .strict()
  .superRefine((calendar, ctx) => {
    if (
      calendar.counter &&
      JSON.stringify(calendar.seasons) !== JSON.stringify(COUNTER_CALENDAR.seasons)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['counter'],
        message: 'A day counter has no seasons to change.',
      });
    }
    const seen = new Set<string>();
    calendar.seasons.forEach((season, i) => {
      const key = season.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['seasons', i, 'name'],
          message: 'Season names must be different.',
        });
      }
      seen.add(key);
    });
  });
