import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { toAppError } from '../db/errors.ts';
import { err, ok, type Result } from '../result.ts';
import type { OpenGuard } from '../store/store.ts';

export const LOCK_FILE = 'workspace.lock';
export const BUSY_MESSAGE = 'This workspace is open in another Mossnote window';

/**
 * Holds an EXCLUSIVE lock on `<dir>/workspace.lock` through its own connection for the
 * store's lifetime. The OS drops it when the process dies (no stale pid files).
 * Nothing else in this process may open that file: closing any fd on an inode releases
 * POSIX locks held on it. The main DB is a different inode, so closing handles on it is safe.
 */
export function acquireLock(dir: string): Result<{ release: () => void }> {
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(join(dir, LOCK_FILE), { timeout: 0 });
    db.pragma('locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE');
  } catch (e) {
    try {
      db?.close();
    } catch {
      /* failing already */
    }
    const r = toAppError(e);
    return !r.ok && r.error.code === 'unavailable' ? err('unavailable', BUSY_MESSAGE, e) : r;
  }
  const held = db;
  let released = false;
  return ok({
    release() {
      if (released) return;
      released = true;
      held.close(); // closing rolls back the open tx and drops the lock
    },
  });
}

/** Pass first in `openStore(..., { guards })`. */
export const lockGuard: OpenGuard = (path) => {
  const dir = dirname(path);
  const r = acquireLock(dir);
  return r.ok ? ok({ release: r.value.release }) : r;
};
