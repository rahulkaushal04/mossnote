import { sha256 } from '../db/hash.ts';
import { err, ok, type Result } from '../result.ts';
import type { Tx } from '../store/store.ts';

export const VERSION_INTERVAL_MS = 5 * 60_000;
export const VERSION_CHARS = 200;
export const THIN_AFTER_DAYS = 30;

export type VersionReason =
  'edit' | 'size' | 'agent' | 'remote' | 'merge_base' | 'restore' | 'pre_restore' | 'recovered';

/** shortcut: O(n) prefix/suffix approximation of an edit distance, exact enough for a 200-char threshold. */
export function changedChars(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return a.length + b.length - 2 * (p + s);
}

/** Inserts a version of the given text and makes it the note's head. Inside the caller's tx. */
export function insertVersion(
  tx: Tx,
  note: { id: string; head_version_id: string | null },
  text: { title: string; body: string; hash: string },
  reason: VersionReason,
  parentId: string | null = note.head_version_id,
): string {
  const id = tx.ulid();
  tx.db
    .prepare(
      `INSERT INTO versions(id, note_id, title, body, content_hash, reason, parent_version_id,
         created_at, device_id, actor_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      note.id,
      text.title,
      text.body,
      text.hash,
      reason,
      parentId,
      tx.now,
      tx.deviceId,
      tx.ctx.actor ?? null,
    );
  tx.db.prepare('UPDATE notes SET head_version_id = ? WHERE id = ?').run(id, note.id);
  note.head_version_id = id;
  return id;
}

interface NoteText {
  id: string;
  title: string;
  body: string;
  content_hash: string;
  head_version_id: string | null;
}

/**
 * Ensures a version equal to the note's current text exists and is the head; returns its id.
 * No-op (returns the head) when the head already holds exactly this text.
 *
 * T42 (sync) calls this with reason 'remote' inside its applyRemote `applyEntity(tx)` callback
 * before writing a remote edit to the note, and with 'merge_base' when a merge base is needed.
 * Writes no change-log row.
 */
export function snapshotNote(tx: Tx, noteId: string, reason: VersionReason): Result<string> {
  const n = tx.db
    .prepare('SELECT id, title, body, content_hash, head_version_id FROM notes WHERE id = ?')
    .get(noteId) as NoteText | undefined;
  if (!n) return err('not_found', 'note not found');
  if (n.head_version_id) {
    const h = tx.db
      .prepare('SELECT title, content_hash FROM versions WHERE id = ?')
      .get(n.head_version_id) as { title: string; content_hash: string } | undefined;
    if (h && h.title === n.title && h.content_hash === n.content_hash) return ok(n.head_version_id);
  }
  return ok(insertVersion(tx, n, { title: n.title, body: n.body, hash: sha256(n.body) }, reason));
}
