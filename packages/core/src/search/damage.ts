import { setMeta } from '../db/meta.ts';
import { createTxRunner } from '../db/tx.ts';
import type { Db } from '../db/types.ts';
import { ok, type AppError } from '../result.ts';
import { SEARCH_TRIGGER_NAMES } from './ddl.ts';

/**
 * Index-damage plumbing shared by the store (startup, mutate) and the search API.
 * Imports no store code: store.ts depends on this file.
 */

export const STATE_KEY = 'search_state';

/** Drops the search triggers and marks the index dirty. No transaction of its own: call inside one (mutate's retry). */
export function quarantineSql(db: Db, reason = 'damage'): void {
  for (const n of SEARCH_TRIGGER_NAMES) db.exec(`DROP TRIGGER IF EXISTS ${n}`);
  setMeta(db, STATE_KEY, 'dirty');
  setMeta(db, 'search_dirty_reason', reason);
}

/** quarantineSql in its own transaction. Never throws. */
export function quarantineIndex(db: Db, reason: string): boolean {
  try {
    return createTxRunner(db)(() => {
      quarantineSql(db, reason);
      return ok(undefined);
    }).ok;
  } catch {
    return false;
  }
}

/**
 * Could this write failure come from the search triggers? Only a cause carrying a SQLite code counts:
 * CORRUPT*, a PRIMARYKEY constraint (damaged structure row) or an fts5 SQLITE_ERROR. The retry in
 * mutate() settles real errors: the same failure with the triggers off propagates unchanged.
 */
export function indexSuspect(e: AppError): boolean {
  const c = e.cause as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof c?.code === 'string' ? c.code : '';
  if (code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
  return code === 'SQLITE_ERROR' && /fts5|note_fts|search_/i.test(String(c?.message ?? ''));
}

/** Every base table a search trigger reads or a save touches (the retry probe, MAJOR 1). */
export const PROBE_TABLES = [
  'notes',
  'note_tags',
  'tags',
  'search_doc',
  'folders',
  'versions',
  'drafts',
  'attachments',
  'note_attachments',
] as const;

/**
 * True when quick_check passes on every probed table. Run BEFORE quarantining triggers and retrying a
 * failed write: a CORRUPT error raised inside a trigger may come from a base table (e.g. the tag
 * subquery reading note_tags), and dropping the triggers would hide that. Any doubt answers false.
 */
export function baseTablesIntact(db: Db): boolean {
  try {
    for (const t of PROBE_TABLES) {
      const rows = db.pragma(`quick_check("${t}")`) as { quick_check: string }[];
      if (rows.some((r) => r.quick_check !== 'ok')) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * After a purge or tag merge: merge the index to one segment so deleted terms leave the file, then
 * fold the WAL. Best effort: the purge is committed already. FTS5 secure-delete is OFF (it cost seconds per tag rename).
 */
export function afterPurge(db: Db): void {
  try {
    db.exec("INSERT INTO note_fts(note_fts) VALUES ('optimize')");
  } catch {
    /* index missing or damaged: the rebuild replaces it */
  }
  try {
    db.exec('DELETE FROM search_stash'); // the stash holds old note text; nothing may survive a purge
  } catch {
    /* table missing or damaged: nothing to clear */
  }
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* closing the workspace retries */
  }
}
