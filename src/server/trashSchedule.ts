import { errorFacts, type Logger } from './logger';

/** How often a server that stays open checks for records past their thirty days. */
export const TRASH_PURGE_INTERVAL_MS = 3_600_000;

interface Timers {
  setInterval(run: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

/**
 * Purge Recently deleted on a timer. Opening a journal purges it, but a server can run for months,
 * and the app tells people that deleted items are gone for good after 30 days. The first check
 * comes one interval after the start, since opening the journal has just done one. A failure is
 * logged (its kind and code, never its message) and the next check goes ahead. Returns a function
 * that stops it.
 */
export function scheduleTrashPurge(
  purge: () => Promise<number>,
  logger: Logger,
  everyMs: number = TRASH_PURGE_INTERVAL_MS,
  timers: Timers = { setInterval, clearInterval },
): () => void {
  let running = false;
  const handle = timers.setInterval(() => {
    if (running) return;
    running = true;
    purge()
      .then(
        (count) => {
          if (count > 0) logger.info('purged old deleted records', { count });
        },
        (error: unknown) => {
          const { name, code } = errorFacts(error);
          logger.error('could not purge old deleted records', {
            kind: name ?? 'unknown',
            ...(code ? { errorCode: code } : {}),
          });
        },
      )
      .finally(() => {
        running = false;
      });
  }, everyMs);
  // A timer alone must never be what keeps the process running.
  handle.unref();
  return () => {
    timers.clearInterval(handle);
  };
}
