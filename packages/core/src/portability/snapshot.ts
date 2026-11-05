import { unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { Store } from '../store/store.ts';

type Backupable = { backup?: (dest: string) => Promise<unknown> };

/**
 * A consistent copy of the live database in `dest` (SQLite online backup; VACUUM INTO when the handle
 * is a test wrapper without it). The copy is switched to journal_mode=DELETE so it is ONE self-contained
 * file: no -wal/-shm travel with it.
 */
export async function snapshotTo(store: Store, dest: string): Promise<void> {
  try {
    const raw = store.db as unknown as Backupable;
    if (typeof raw.backup === 'function') await raw.backup(dest);
    else store.db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    const c = new Database(dest);
    try {
      c.pragma('journal_mode = DELETE');
    } finally {
      c.close();
    }
  } catch (e) {
    for (const x of [dest, `${dest}-wal`, `${dest}-shm`]) {
      try {
        unlinkSync(x);
      } catch {
        /* not there */
      }
    }
    throw e;
  }
}

export const countOf = (db: InstanceType<typeof Database>, table: string): number =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
