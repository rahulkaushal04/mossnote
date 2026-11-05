/**
 * Bulk operations (PT-11). Each call is ONE mutateMany transaction: every id is validated, then all
 * writes and one change-log row per note changed commit together or not at all. Undo is the inverse call
 * (`bulk.untrash` for trash; move/tag are their own inverse with `undo: true`, which skips items that
 * changed meanwhile instead of failing, and reports them).
 */
import { err, ok, type Result } from '../result.ts';
import { bulkMoveIn, bulkTagIn, bulkTrashIn, bulkUntrashIn, MAX_BULK } from '../rpc/contract.ts';
import type { Store, Tx } from '../store/store.ts';
import { folderIsTrashed, noteIsTrashed, parse } from '../trash/derive.ts';

export { MAX_BULK };

interface NoteRow {
  id: string;
  folder_id: string | null;
  trashed_at: number | null;
}
const load = (tx: Tx, noteId: string): NoteRow | undefined =>
  tx.db.prepare('SELECT id, folder_id, trashed_at FROM notes WHERE id = ?').get(noteId) as NoteRow | undefined;

/** A live note, or why not. */
function liveNote(tx: Tx, noteId: string): Result<NoteRow> {
  const n = load(tx, noteId);
  if (!n) return err('not_found', 'note not found');
  if (noteIsTrashed(tx.db, n)) return err('conflict', 'note is in the trash');
  return ok(n);
}

export function createBulkApi(s: Store) {
  return {
    move(input: unknown): Result<{ previous: { id: string; folderId: string | null }[]; skipped: string[] }> {
      const p = parse(bulkMoveIn, input);
      if (!p.ok) return p;
      const undo = p.value.undo === true;
      return s.mutateMany({}, (tx) => {
        const previous: { id: string; folderId: string | null }[] = [];
        const skipped: string[] = [];
        const seen = new Set<string>();
        const folderOk = new Map<string | null, boolean>([[null, true]]);
        const targetOk = (f: string | null): boolean => {
          let v = folderOk.get(f);
          if (v === undefined) {
            v = !!tx.db.prepare('SELECT 1 AS x FROM folders WHERE id = ?').get(f) && !folderIsTrashed(tx.db, f!);
            folderOk.set(f, v);
          }
          return v;
        };
        const upd = tx.db.prepare('UPDATE notes SET folder_id = ?, updated_at = ? WHERE id = ?');
        for (const it of p.value.items) {
          if (seen.has(it.id)) return err('validation', 'the same note was listed twice');
          seen.add(it.id);
          const n = liveNote(tx, it.id);
          const tOk = targetOk(it.folderId);
          if (!n.ok || !tOk) {
            if (undo) {
              skipped.push(it.id);
              continue;
            }
            return n.ok ? err('not_found', 'folder not found') : n;
          }
          if (n.value.folder_id === it.folderId) continue; // already there: no write, no row
          upd.run(it.folderId, tx.now, it.id);
          const l = tx.log({ entity: 'note', entityId: it.id, op: 'move', fields: { folderId: it.folderId } });
          if (!l.ok) return l;
          previous.push({ id: it.id, folderId: n.value.folder_id });
        }
        return ok({ previous, skipped });
      });
    },

    tag(input: unknown): Result<{ changed: string[]; skipped: string[] }> {
      const p = parse(bulkTagIn, input);
      if (!p.ok) return p;
      const { tagId, on } = p.value;
      const undo = p.value.undo === true;
      return s.mutateMany({}, (tx) => {
        if (!tx.db.prepare('SELECT 1 AS x FROM tags WHERE id = ?').get(tagId)) return err('not_found', 'tag not found');
        const changed: string[] = [];
        const skipped: string[] = [];
        const has = tx.db.prepare('SELECT 1 AS x FROM note_tags WHERE note_id = ? AND tag_id = ?');
        const add = tx.db.prepare('INSERT INTO note_tags(note_id, tag_id, created_at) VALUES (?,?,?)');
        const del = tx.db.prepare('DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?');
        for (const noteId of new Set(p.value.ids)) {
          const n = liveNote(tx, noteId);
          if (!n.ok) {
            if (undo) {
              skipped.push(noteId);
              continue;
            }
            return n;
          }
          if (!!has.get(noteId, tagId) === on) continue;
          if (on) add.run(noteId, tagId, tx.now);
          else del.run(noteId, tagId);
          const l = tx.log({
            entity: 'note_tag',
            entityId: `${noteId}:${tagId}`,
            op: 'update',
            fields: { present: on },
          });
          if (!l.ok) return l;
          changed.push(noteId);
        }
        return ok({ changed, skipped });
      });
    },

    /** Every note keeps its own trash batch id, so each is restorable alone (and all together by untrash). */
    trash(input: unknown): Result<{ batchIds: string[] }> {
      const p = parse(bulkTrashIn, input);
      if (!p.ok) return p;
      return s.mutateMany({}, (tx) => {
        const batchIds: string[] = [];
        const upd = tx.db.prepare(
          'UPDATE notes SET trashed_at = ?, trash_batch_id = ?, trash_notice_at = NULL WHERE id = ?',
        );
        for (const noteId of new Set(p.value.ids)) {
          const n = liveNote(tx, noteId);
          if (!n.ok) return n;
          const batchId = tx.ulid();
          upd.run(tx.now, batchId, noteId);
          const l = tx.log({ entity: 'note', entityId: noteId, op: 'trash', fields: { batchId } });
          if (!l.ok) return l;
          batchIds.push(batchId);
        }
        return ok({ batchIds });
      });
    },

    /** The single Undo of bulk.trash. Batches that no longer exist (purged, already restored) are counted, not fatal. */
    untrash(input: unknown): Result<{ restored: number; skipped: number; ids: string[] }> {
      const p = parse(bulkUntrashIn, input);
      if (!p.ok) return p;
      return s.mutateMany({}, (tx) => {
        let skipped = 0;
        const ids: string[] = [];
        const find = tx.db.prepare('SELECT id, folder_id FROM notes WHERE trash_batch_id = ? AND trashed_at IS NOT NULL');
        for (const batchId of new Set(p.value.batchIds)) {
          const n = find.get(batchId) as { id: string; folder_id: string | null } | undefined;
          if (!n) {
            skipped++;
            continue;
          }
          const orphan = n.folder_id !== null && folderIsTrashed(tx.db, n.folder_id);
          tx.db
            .prepare(
              `UPDATE notes SET trashed_at = NULL, trash_batch_id = NULL, trash_notice_at = NULL,
                 ${orphan ? 'folder_id = NULL,' : ''} updated_at = ? WHERE id = ?`,
            )
            .run(tx.now, n.id);
          const fields: Record<string, unknown> = { batchId };
          if (orphan) fields.folderId = null;
          const l = tx.log({ entity: 'note', entityId: n.id, op: 'restore', fields });
          if (!l.ok) return l;
          ids.push(n.id);
        }
        return ok({ restored: ids.length, skipped, ids });
      });
    },
  };
}
export type BulkApi = ReturnType<typeof createBulkApi>;
