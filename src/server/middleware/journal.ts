import type { MiddlewareHandler } from 'hono';
import { conflict } from '../errors';
import type { Env } from '../env';
import { NO_JOURNAL, type Ctx } from '../services/ctx';

/** Which journal the web app believes it is showing. Optional: scripts and tests may omit it. */
export const JOURNAL_HEADER = 'x-moss-journal';

/** Paths that work with no journal open, or while another is open. */
const OPEN_PATHS = /^\/api\/(?:health|journals|phone)(?:\/|$)/;

/**
 * Two guards for the open journal:
 *  - no journal open (first run): data routes answer 409 `no_journal`, which the web app turns
 *    into the "Which template?" screen;
 *  - a request that names a journal other than the open one (another window switched) is refused
 *    with 409 `journal_changed`, so a stale window can never write into the wrong journal.
 */
export function requireJournal(ctx: Ctx): MiddlewareHandler<Env> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (OPEN_PATHS.test(path)) return next();
    if (!ctx.attached) throw conflict(NO_JOURNAL, { reason: 'no_journal' });
    const claimed = c.req.header(JOURNAL_HEADER);
    if (claimed !== undefined && claimed !== ctx.config.journal) {
      throw conflict(
        'You switched journals in another window. Reload this page to continue here.',
        { reason: 'journal_changed' },
      );
    }
    return next();
  };
}
