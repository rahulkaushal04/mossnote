import { z } from 'zod';
import { redactFields } from '../changelog/append.ts';
import { err, ok, type Result } from '../result.ts';
import type { Ctx, Store, Tx } from '../store/store.ts';
import { noteIsTrashed, parse, safe } from '../trash/derive.ts';

export interface Tag {
  id: string;
  name: string;
  nameKey: string;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
}

/**
 * Uniqueness key. NFKC + toLowerCase only: full Unicode case folding (e.g. 'ß' vs 'ss') is NOT
 * done, so those stay distinct tags. Locale-independent on purpose.
 */
export const tagKey = (name: string): string => name.normalize('NFKC').toLowerCase();

interface Row {
  id: string;
  name: string;
  name_key: string;
  created_at: number;
  updated_at: number;
  device_id: string;
}
const COLS = 'id, name, name_key, created_at, updated_at, device_id';
const toTag = (r: Row): Tag => ({
  id: r.id,
  name: r.name,
  nameKey: r.name_key,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deviceId: r.device_id,
});

const name = z.string().trim().min(1).max(100);
const id = z.string().min(1).max(64);
const renameOpts = z.object({ confirmMerge: z.literal(true).optional() }).strict();

export type RenameResult =
  | { kind: 'renamed'; tag: Tag }
  /** A different tag already has this name (case-insensitively). Nothing was written. */
  | { kind: 'needsMerge'; into: Tag }
  /** Confirmed: the renamed tag was purged into `tag` (memberships moved). */
  | { kind: 'merged'; tag: Tag };

export function createTagsApi(s: Store) {
  const byId = (tx: Tx, tid: string): Row | undefined =>
    tx.db.prepare(`SELECT ${COLS} FROM tags WHERE id = ?`).get(tid) as Row | undefined;
  const byKey = (tx: Tx, key: string): Row | undefined =>
    tx.db.prepare(`SELECT ${COLS} FROM tags WHERE name_key = ?`).get(key) as Row | undefined;

  return {
    /** Returns the existing tag when the name matches case-insensitively (no write, no row). */
    create(ctx: Ctx, input: unknown): Result<Tag> {
      const n = parse(name, input);
      if (!n.ok) return n;
      return s.mutate(ctx, (tx) => {
        const key = tagKey(n.value);
        const ex = byKey(tx, key);
        if (ex) return ok(toTag(ex));
        const tid = tx.ulid();
        tx.db
          .prepare(
            'INSERT INTO tags(id, name, name_key, created_at, updated_at, device_id) VALUES (?,?,?,?,?,?)',
          )
          .run(tid, n.value, key, tx.now, tx.now, tx.deviceId);
        const l = tx.log({ entity: 'tag', entityId: tid, op: 'create', fields: { name: n.value } });
        return l.ok ? ok(toTag(byId(tx, tid)!)) : l;
      });
    },

    get(tid: string): Result<Tag> {
      const p = parse(id, tid);
      if (!p.ok) return p;
      return safe(() => {
        const r = s.db.prepare(`SELECT ${COLS} FROM tags WHERE id = ?`).get(tid) as Row | undefined;
        return r ? ok(toTag(r)) : err('not_found', 'tag not found');
      });
    },

    list(): Result<Tag[]> {
      return safe(() =>
        ok((s.db.prepare(`SELECT ${COLS} FROM tags ORDER BY name_key`).all() as Row[]).map(toTag)),
      );
    },

    listForNote(noteId: string): Result<Tag[]> {
      const p = parse(id, noteId);
      if (!p.ok) return p;
      return safe(() =>
        ok(
          (
            s.db
              .prepare(
                `SELECT t.id, t.name, t.name_key, t.created_at, t.updated_at, t.device_id
                 FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?
                 ORDER BY t.name_key`,
              )
              .all(noteId) as Row[]
          ).map(toTag),
        ),
      );
    },

    /**
     * A name that collides case-insensitively with ANOTHER tag never merges implicitly (CS-17):
     * without `{confirmMerge: true}` it returns `needsMerge` and writes nothing. Confirmed, it is ONE
     * change-log row: a purge of this (source) tag with `merged_into` and a tombstone for the source
     * tag id only. Memberships move to the target. A case-only rename of the same tag is a plain update.
     */
    rename(ctx: Ctx, tid: string, newName: unknown, opts: unknown = {}): Result<RenameResult> {
      const ti = parse(id, tid);
      if (!ti.ok) return ti;
      const n = parse(name, newName);
      if (!n.ok) return n;
      const o = parse(renameOpts, opts);
      if (!o.ok) return o;
      return s.mutate<RenameResult>(ctx, (tx) => {
        const src = byId(tx, tid);
        if (!src) return err('not_found', 'tag not found');
        const key = tagKey(n.value);
        const other = byKey(tx, key);
        if (other && other.id !== tid) {
          if (!o.value.confirmMerge) return ok({ kind: 'needsMerge', into: toTag(other) });
          tx.db
            .prepare(
              `INSERT OR IGNORE INTO note_tags(note_id, tag_id, created_at)
               SELECT note_id, ?, created_at FROM note_tags WHERE tag_id = ?`,
            )
            .run(other.id, tid);
          tx.db.prepare('DELETE FROM note_tags WHERE tag_id = ?').run(tid);
          tx.db.prepare('DELETE FROM tags WHERE id = ?').run(tid);
          redactFields(tx.db, [tid]);
          const l = tx.log({
            entity: 'tag',
            entityId: tid,
            op: 'purge',
            purged: [{ entity: 'tag', id: tid }],
            mergedInto: other.id,
          });
          return l.ok ? ok({ kind: 'merged', tag: toTag(other) }) : l;
        }
        if (src.name === n.value) return ok({ kind: 'renamed', tag: toTag(src) });
        tx.db
          .prepare('UPDATE tags SET name = ?, name_key = ?, updated_at = ? WHERE id = ?')
          .run(n.value, key, tx.now, tid);
        const l = tx.log({ entity: 'tag', entityId: tid, op: 'update', fields: { name: n.value } });
        return l.ok ? ok({ kind: 'renamed', tag: toTag(byId(tx, tid)!) }) : l;
      });
    },

    /** Idempotent: tagging an already-tagged note writes nothing. */
    tagNote: (ctx: Ctx, noteId: string, tid: string): Result<void> =>
      membership(true, ctx, noteId, tid),
    /** Logged as note_tag update {present:false}; no tombstone. Idempotent. */
    untagNote: (ctx: Ctx, noteId: string, tid: string): Result<void> =>
      membership(false, ctx, noteId, tid),
  };

  function membership(present: boolean, ctx: Ctx, noteId: string, tid: string): Result<void> {
    const ids = parse(z.tuple([id, id]), [noteId, tid]);
    if (!ids.ok) return ids;
    return s.mutate(ctx, (tx) => {
      const n = tx.db
        .prepare('SELECT folder_id, trashed_at FROM notes WHERE id = ?')
        .get(noteId) as { folder_id: string | null; trashed_at: number | null } | undefined;
      if (!n) return err('not_found', 'note not found');
      if (!byId(tx, tid)) return err('not_found', 'tag not found');
      if (noteIsTrashed(tx.db, n)) return err('conflict', 'note is in the trash');
      const has = !!tx.db
        .prepare('SELECT 1 AS x FROM note_tags WHERE note_id = ? AND tag_id = ?')
        .get(noteId, tid);
      if (has === present) return ok(undefined);
      if (present)
        tx.db
          .prepare('INSERT INTO note_tags(note_id, tag_id, created_at) VALUES (?,?,?)')
          .run(noteId, tid, tx.now);
      else tx.db.prepare('DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?').run(noteId, tid);
      const l = tx.log({
        entity: 'note_tag',
        entityId: `${noteId}:${tid}`,
        op: 'update',
        fields: { present },
      });
      return l.ok ? ok(undefined) : l;
    });
  }
}
export type TagsApi = ReturnType<typeof createTagsApi>;
