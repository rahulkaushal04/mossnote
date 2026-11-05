import { getMeta, setMeta } from '../db/meta.ts';
import type { Db } from '../db/types.ts';
import { indexVerdict } from '../integrity/index.ts';
import { err, ok, type Result } from '../result.ts';
import type { Store } from '../store/store.ts';
import { safe } from '../trash/derive.ts';
import { quarantineSql, STATE_KEY } from './damage.ts';
import {
  SEARCH_ATT_EXPR,
  SEARCH_FTS_SQL,
  SEARCH_TAGS_EXPR,
  SEARCH_TRIGGERS_SQL,
} from './ddl.ts';

/**
 * Index state machine, kept in meta `search_state`: 'ok' | 'dirty' | 'rebuilding'.
 *
 * Rebuild = start (one tx: drop and recreate the FTS table, its settings and the triggers, empty
 * search_doc, state 'rebuilding'), then slices of N notes (one tx each): a slice inserts the next N
 * notes into search_doc AND into the index together. Invariant: a note has a search_doc row iff it is
 * indexed. So the normal triggers are correct between slices: a write to a not-yet-indexed note
 * touches nothing (the later slice reads its current text); a new note is indexed at once; an
 * indexed note is updated normally. That is the catch-up for concurrent writes. The last slice finds
 * nothing left and flips the state to 'ok'.
 */

export const SLICE_SIZE = 500;
const PROGRESS_KEY = 'search_progress';

export interface Progress {
  done: number;
  total: number;
}
export type IndexStatus =
  | { state: 'ready' }
  | { state: 'dirty' }
  | { state: 'rebuilding'; progress: Progress }
  /** The automatic rebuild failed twice. Only a manual rebuild (requestRebuild) or a restart re-arms it. */
  | { state: 'error'; message: string };
export interface StepResult {
  done: boolean;
  processed: number;
  total: number;
}

interface Saved extends Progress {
  cursor: string;
}

const count = (db: Db, table: string): number =>
  (db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;

/** DROP TABLE fails on a damaged config row; unsafeMode plus restoring the version row lets it through. */
function dropFts(db: Db): void {
  try {
    db.exec('DROP TABLE IF EXISTS note_fts');
    return;
  } catch (e) {
    const u = db as unknown as { unsafeMode?: (on: boolean) => void };
    if (!u.unsafeMode) throw e;
    u.unsafeMode(true);
    try {
      db.exec("INSERT OR REPLACE INTO note_fts_config(k, v) VALUES ('version', 4)");
      db.exec('DROP TABLE IF EXISTS note_fts');
    } finally {
      u.unsafeMode(false);
    }
  }
}

export function createIndexAdmin(store: Store, sliceSize = SLICE_SIZE) {
  const db = store.db;
  let checked = false;
  // Failure policy (session scoped): one automatic retry after a failed step, then 'error' until re-armed.
  let failures = 0;
  let halted: string | undefined;

  const readProgress = (): Saved => {
    try {
      const p = JSON.parse(getMeta(db, PROGRESS_KEY) ?? '') as Saved;
      return { done: p.done | 0, total: p.total | 0, cursor: String(p.cursor ?? '') };
    } catch {
      return { done: 0, total: count(db, 'notes'), cursor: '' };
    }
  };

  const markDirty = (reason: string): Result<void> =>
    store.mutate({}, (tx) => {
      quarantineSql(tx.db, reason);
      return ok(undefined);
    });

  const start = (): Result<void> => {
    // DROP TABLE and secure_delete would zero live pages if the damage is not confined to the FTS tables.
    // A table-restricted quick_check skips page accounting, so this is the FULL check (see indexVerdict).
    if (indexVerdict(store.path) === 'corrupt')
      return err(
        'corrupt',
        'The search index cannot be rebuilt because the workspace database itself is damaged. Restore a backup.',
      );
    return store.mutate({}, (tx) => {
      const d = tx.db;
      quarantineSql(d, 'rebuild'); // triggers off while the structure is replaced
      dropFts(d);
      d.exec('DELETE FROM search_doc; DELETE FROM search_stash;');
      d.exec(SEARCH_FTS_SQL);
      d.exec(SEARCH_TRIGGERS_SQL);
      setMeta(d, PROGRESS_KEY, JSON.stringify({ done: 0, total: count(d, 'notes'), cursor: '' }));
      setMeta(d, STATE_KEY, 'rebuilding');
      return ok(undefined);
    });
  };

  const slice = (): Result<StepResult> =>
    store.mutate<StepResult>({}, (tx) => {
      const d = tx.db;
      const p = readProgress();
      const before = (
        d.prepare('SELECT coalesce(max(rid), 0) AS m FROM search_doc').get() as { m: number }
      ).m;
      const todo = `FROM notes n WHERE n.id > ? AND NOT EXISTS (SELECT 1 FROM search_doc x WHERE x.note_id = n.id)`;
      const ins = d
        .prepare(
          `INSERT INTO search_doc(note_id, tags, att) SELECT n.id, ${SEARCH_TAGS_EXPR('n.id')}, ${SEARCH_ATT_EXPR('n.id')} ${todo} ORDER BY n.id LIMIT ?`,
        )
        .run(p.cursor, sliceSize);
      const total = count(d, 'notes');
      if (ins.changes === 0) {
        const missed = d
          .prepare(
            'SELECT 1 AS x FROM notes n WHERE NOT EXISTS (SELECT 1 FROM search_doc x WHERE x.note_id = n.id) LIMIT 1',
          )
          .get();
        if (missed) {
          setMeta(d, PROGRESS_KEY, JSON.stringify({ ...p, total, cursor: '' }));
          return ok({ done: false, processed: 0, total });
        }
        d.prepare('DELETE FROM meta WHERE key = ?').run(PROGRESS_KEY);
        setMeta(d, STATE_KEY, 'ok');
        return ok({ done: true, processed: 0, total });
      }
      d.prepare(
        'INSERT INTO note_fts(rowid, title, body, tags, att) SELECT rid, title, body, tags, att FROM search_src WHERE rid > ?',
      ).run(before);
      const last = d
        .prepare('SELECT max(note_id) AS m FROM search_doc WHERE rid > ?')
        .get(before) as { m: string };
      const done = p.done + ins.changes;
      setMeta(
        d,
        PROGRESS_KEY,
        JSON.stringify({ done, total: Math.max(total, done), cursor: last.m }),
      );
      return ok({ done: false, processed: ins.changes, total: Math.max(total, done) });
    });

  const state = (): string => getMeta(db, STATE_KEY) ?? '';

  const api = {
    /** First call also compares document counts (cheap), so a missing search_doc row is noticed. */
    status(): Result<IndexStatus> {
      return safe(() => {
        let s = state();
        if (s === 'ok' && !checked) {
          checked = true;
          if (count(db, 'search_doc') !== count(db, 'notes')) {
            const m = markDirty('document count mismatch');
            if (!m.ok) return m;
            s = 'dirty';
          }
        }
        if (s === 'ok') {
          halted = undefined;
          return ok({ state: 'ready' } as IndexStatus);
        }
        if (halted) return ok({ state: 'error', message: halted } as IndexStatus);
        if (s === 'rebuilding') {
          const { done, total } = readProgress();
          return ok({ state: 'rebuilding', progress: { done, total } } as IndexStatus);
        }
        return ok({ state: 'dirty' } as IndexStatus);
      });
    },

    /**
     * One slice of work. From 'dirty' it first replaces the index structure. 'ok' = nothing to do.
     * After the second failure in a session the state is 'error' and this refuses until re-armed.
     */
    rebuildStep(): Result<StepResult> {
      if (halted) return err('unavailable', halted);
      const r = safe(() => {
        const s = state();
        if (s === 'ok') return ok({ done: true, processed: 0, total: count(db, 'notes') });
        if (s !== 'rebuilding') {
          const st = start();
          if (!st.ok) return st;
        }
        return slice();
      });
      if (!r.ok) {
        if (++failures >= 2) halted = r.error.message;
      } else if (r.value.done) failures = 0;
      return r;
    },

    /** Re-arms the automatic rebuild (clears 'error') and marks the index dirty; the pump does the work. */
    requestRebuild(): Result<void> {
      failures = 0;
      halted = undefined;
      return state() === 'rebuilding' ? ok(undefined) : markDirty('manual rebuild');
    },

    /** Full rebuild now (tests, CLI). Re-arms, then continues one already under way. A failure leaves 'error'. */
    rebuild(): Result<void> {
      const q = api.requestRebuild();
      if (!q.ok) return q;
      for (;;) {
        const r = api.rebuildStep();
        if (!r.ok) {
          halted = r.error.message;
          return r;
        }
        if (r.value.done) return ok(undefined);
      }
    },

    markDirty,

    /**
     * Deep check (integrity-check with content comparison). BLOCKING and O(index size): run it on
     * demand, not per keystroke. While the index is not 'ok' there is nothing to verify (it is being
     * replaced): reports `skipped`, not a problem. A failure marks the index dirty.
     */
    verify(): Result<{ ok: boolean; skipped?: boolean }> {
      if (state() !== 'ok') return ok({ ok: true, skipped: true });
      try {
        db.exec("INSERT INTO note_fts(note_fts, rank) VALUES ('integrity-check', 1)");
        if (count(db, 'search_doc') === count(db, 'notes')) return ok({ ok: true });
      } catch {
        /* damaged: fall through */
      }
      const m = markDirty('integrity check failed');
      return m.ok ? ok({ ok: false }) : m;
    },
  };
  return api;
}
export type IndexAdmin = ReturnType<typeof createIndexAdmin>;
