import { zValidator } from '@hono/zod-validator';
import { z, type ZodType } from 'zod';
import { ulidSchema } from '@shared/schemas/common';
import { fromZod } from './errors';

/** JSON body validation with the shared zod schemas. Failures use the API error shape (400). */
export const validateJson = <T extends ZodType>(schema: T) =>
  zValidator('json', schema, (result) => {
    if (!result.success) throw fromZod(result.error);
  });

/** Query-string validation, same error shape. */
export const validateQuery = <T extends ZodType>(schema: T) =>
  zValidator('query', schema, (result) => {
    if (!result.success) throw fromZod(result.error);
  });

/** `:id` path parameters must be ULIDs; anything else is `validation_failed`. */
export const validateId = zValidator('param', z.object({ id: ulidSchema }), (result) => {
  if (!result.success) throw fromZod(result.error);
});
