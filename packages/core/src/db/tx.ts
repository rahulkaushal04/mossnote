import { toAppError } from './errors.ts';
import type { Db } from './types.ts';
import type { Result } from '../result.ts';

/** BEGIN IMMEDIATE / COMMIT with prepared statements; ROLLBACK only if a tx is still open
 *  (SQLite auto-rolls back on FULL/IOERR, and a blind ROLLBACK would mask the real error). */
export function createTxRunner(db: Db) {
  const begin = db.prepare('BEGIN IMMEDIATE');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');
  return function run<T>(fn: () => Result<T>): Result<T> {
    // Nested call: the outer transaction is not ours to roll back, whatever BEGIN reports.
    const outer = db.inTransaction;
    try {
      begin.run();
    } catch (e) {
      // BEGIN may have run before it reported an error; never leave the connection inside a tx.
      if (!outer && db.inTransaction) {
        try {
          rollback.run();
        } catch {
          /* the BEGIN error is the one to report */
        }
      }
      return toAppError(e);
    }
    let out: Result<T>;
    try {
      out = fn();
      if (out.ok) commit.run();
    } catch (e) {
      out = toAppError(e);
    }
    if (db.inTransaction) {
      try {
        rollback.run();
      } catch (e) {
        if (out.ok) out = toAppError(e);
      }
    }
    return out;
  };
}
