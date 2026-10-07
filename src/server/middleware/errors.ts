import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import type { Logger } from '../logger';
import type { Env } from '../env';

/** The part of a zod error these helpers read (works for both zod and zod-core errors). */
interface IssueSource {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}

/** Field map keyed by dotted path, first message per path. */
export function zodFields(error: IssueSource): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.');
    fields[key] ||= issue.message;
  }
  return fields;
}

export function fromZod(error: IssueSource): AppError {
  const fields = zodFields(error);
  const message = error.issues[0]?.message ?? 'That request is not valid.';
  return new AppError('validation_failed', message, { fields });
}

function isDiskFull(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'SQLITE_FULL' || code === 'ENOSPC';
}

/**
 * Central error mapping (spec section 20). Anything that is not an AppError becomes 500
 * `internal` with a short request id. Messages never contain user text and never include stack
 * traces; the log line carries metadata only.
 */
export function errorHandler(logger: Logger): ErrorHandler<Env> {
  return (error, c) => {
    const requestId = (c.get('requestId') as string | undefined) ?? 'unknown';
    let app: AppError;

    if (error instanceof AppError) {
      app = error;
    } else if (error instanceof ZodError) {
      app = fromZod(error);
    } else if (error instanceof HTTPException && error.status === 400) {
      app = new AppError('validation_failed', 'That request is not valid JSON.');
    } else if (error instanceof HTTPException && error.status === 413) {
      app = new AppError('too_large', 'That request is too large.');
    } else if (isDiskFull(error)) {
      app = new AppError(
        'storage_full',
        'Your disk looks full. Nothing was lost. Free some space and try again.',
      );
    } else {
      app = new AppError('internal', `Something went wrong. Reference ${requestId}.`);
    }

    if (app.status >= 500) {
      logger.error('request failed', {
        id: requestId,
        code: app.code,
        kind: error instanceof Error ? error.name : 'unknown',
      });
    }
    return c.json(app.toBody(), app.status);
  };
}

export const notFoundHandler: NotFoundHandler<Env> = (c) =>
  c.json(new AppError('not_found', 'Not found.').toBody(), 404);
