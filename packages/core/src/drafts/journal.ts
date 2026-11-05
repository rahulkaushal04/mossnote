import { z } from 'zod';
import { toAppError } from '../db/errors.ts';
import type { Db, Clock } from '../db/types.ts';
import { err, ok, type AppError, type Result } from '../result.ts';
import type { Store } from '../store/store.ts';
import { noteIsTrashed, parse } from '../trash/derive.ts';

/** The note state the draft was typed against. */
export interface DraftBase {
  rev: number;
  contentHash: string;
}
export interface RecoverableDraft {
  seq: number;
  noteId: string;
  body: string;
  savedAt: number;
  base: DraftBase;
  /** The note changed (or was trashed) since the draft's base: the UI must ask, never silently apply. */
  baseChanged: boolean;
  matchesNote: boolean;
}
const noteId_ = z.string().min(1).max(64);
const writeIn = z.object({
  noteId: noteId_,
  text: z.string().max(10_000_000),
  base: z.object({ rev: z.number().int().min(0), contentHash: z.string().regex(/^[0-9a-f]{64}$/) }),
});

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}
export interface DraftsOptions {
  quietMs?: number;
  maxWaitMs?: number;
  timers?: Timers;
  onError?: (e: unknown, noteId: string) => void;
}
export interface DraftsApi {
  /** Buffers `text`; it reaches the journal after quietMs of silence or maxWaitMs, whichever comes first. */
  write(noteId: string, text: string, base: DraftBase): Result<void>;
  /** Writes pending drafts now. Returns the draft seq per note (the cleanup key). */
  flush(noteId?: string): Result<Record<string, number>>;
  /** Deletes the note's drafts with seq <= upToSeq. Never matches on text. */
  discardUpTo(noteId: string, upToSeq: number): Result<number>;
  /** Drops the not-yet-written buffer (call after the text was saved as the note). */
  discardPending(noteId: string): void;
  /** Latest draft per note, newest first, for the open-time "unsaved text" prompt. */
  recover(noteId?: string): Result<RecoverableDraft[]>;
  dispose(): void;
}

/** For use inside a mutate() tx so the delete commits atomically with the save. */
export function deleteDraftsUpTo(db: Db, noteId: string, upToSeq: number): number {
  return db.prepare('DELETE FROM drafts WHERE note_id = ? AND seq <= ?').run(noteId, upToSeq)
    .changes;
}

interface Pending {
  text: string;
  base: DraftBase;
  firstAt: number;
  timer?: unknown;
}

export function createDraftsApi(
  store: Pick<Store, 'db' | 'mutate' | 'clock'>,
  opts: DraftsOptions = {},
): DraftsApi {
  const quietMs = opts.quietMs ?? 300;
  const maxWaitMs = opts.maxWaitMs ?? 800;
  const timers: Timers = opts.timers ?? {
    setTimeout: (f, ms) => setTimeout(f, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const clock: Clock = store.clock;
  const pending = new Map<string, Pending>();
  let disposed = false;

  const stop = (p: Pending) => {
    if (p.timer !== undefined) timers.clearTimeout(p.timer);
    p.timer = undefined;
  };

  function flush(noteId?: string): Result<Record<string, number>> {
    if (noteId !== undefined) {
      const v = parse(noteId_, noteId);
      if (!v.ok) return v;
    }
    const ids = noteId === undefined ? [...pending.keys()] : pending.has(noteId) ? [noteId] : [];
    const seqs: Record<string, number> = {};
    const failed: string[] = [];
    let first: AppError | undefined;
    for (const id of ids) {
      const p = pending.get(id)!;
      stop(p);
      const r = store.mutate({}, (tx) => {
        // Only the newest draft per note is kept; older rows are superseded in the same tx.
        const seq = Number(
          tx.db
            .prepare(
              'INSERT INTO drafts(note_id, body, base_rev, base_content_hash, saved_at) VALUES (?,?,?,?,?)',
            )
            .run(id, p.text, p.base.rev, p.base.contentHash, tx.now).lastInsertRowid,
        );
        deleteDraftsUpTo(tx.db, id, seq - 1);
        return ok(seq);
      });
      if (!r.ok) {
        // One bad note must not stop the others from reaching the journal.
        failed.push(id);
        first ??= r.error;
        // A note that no longer exists can never be saved (FK): drop it instead of retrying forever.
        // Anything else stays pending; the next write or flush retries.
        try {
          if (
            !store.db.prepare('SELECT 1 FROM notes WHERE id = ?').get(id) &&
            pending.get(id) === p
          )
            pending.delete(id);
        } catch {
          /* keep it pending */
        }
        continue;
      }
      if (pending.get(id) === p) pending.delete(id);
      seqs[id] = r.value;
    }
    if (first)
      return err(
        first.code,
        `${first.message} (draft not saved for: ${failed.join(', ')})`,
        first.cause,
      );
    return ok(seqs);
  }

  function schedule(id: string, p: Pending) {
    stop(p);
    const left = p.firstAt + maxWaitMs - clock.now();
    p.timer = timers.setTimeout(
      () => {
        p.timer = undefined;
        const r = flush(id);
        if (!r.ok) opts.onError?.(r.error, id);
      },
      Math.max(0, Math.min(quietMs, left)),
    );
  }

  return {
    write(noteId, text, base) {
      const v = parse(writeIn, { noteId, text, base });
      if (!v.ok) return v; // a bad value must never sit in pending: it would fail every retry
      if (disposed) return ok(undefined);
      const p = pending.get(noteId);
      if (p) {
        p.text = text;
        p.base = base;
        schedule(noteId, p);
      } else {
        const n: Pending = { text, base, firstAt: clock.now() };
        pending.set(noteId, n);
        schedule(noteId, n);
      }
      return ok(undefined);
    },
    flush,
    discardUpTo(noteId, upToSeq) {
      const v = parse(z.tuple([noteId_, z.number().int().min(0)]), [noteId, upToSeq]);
      if (!v.ok) return v;
      return store.mutate({}, (tx) => ok(deleteDraftsUpTo(tx.db, noteId, upToSeq)));
    },
    discardPending(noteId) {
      const p = pending.get(noteId);
      if (p) stop(p);
      pending.delete(noteId);
    },
    recover(noteId) {
      try {
        const rows = store.db
          .prepare(
            `SELECT d.seq, d.note_id, d.body, d.saved_at, d.base_rev, d.base_content_hash,
                    n.rev AS n_rev, n.content_hash AS n_hash, n.body AS n_body, n.trashed_at AS n_trashed,
                    n.folder_id AS n_folder
               FROM drafts d LEFT JOIN notes n ON n.id = d.note_id
              WHERE d.seq = (SELECT MAX(seq) FROM drafts WHERE note_id = d.note_id)
                AND (? IS NULL OR d.note_id = ?)
              ORDER BY d.seq DESC`,
          )
          .all(noteId ?? null, noteId ?? null) as Record<string, unknown>[];
        return ok(
          rows.map((r) => ({
            seq: r.seq as number,
            noteId: r.note_id as string,
            body: r.body as string,
            savedAt: r.saved_at as number,
            base: { rev: r.base_rev as number, contentHash: r.base_content_hash as string },
            baseChanged:
              r.n_rev !== r.base_rev ||
              r.n_hash !== r.base_content_hash ||
              noteIsTrashed(store.db, {
                folder_id: r.n_folder as string | null,
                trashed_at: r.n_trashed as number | null,
              }),
            matchesNote: r.n_body === r.body,
          })),
        );
      } catch (e) {
        return toAppError(e);
      }
    },
    dispose() {
      disposed = true;
      for (const p of pending.values()) stop(p);
      pending.clear();
    },
  };
}
