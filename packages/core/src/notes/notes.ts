import { z } from 'zod';
import { sha256 } from '../db/hash.ts';
import { deleteDraftsUpTo } from '../drafts/journal.ts';
import { err, ok, type Result } from '../result.ts';
import type { Ctx, Store, Tx } from '../store/store.ts';
import { folderIsTrashed, noteIsTrashed, parse, safe, trashedFolderIds } from '../trash/derive.ts';
import {
  changedChars,
  insertVersion,
  snapshotNote,
  VERSION_CHARS,
  VERSION_INTERVAL_MS,
  type VersionReason,
} from '../versions/snapshot.ts';

export interface Note {
  id: string;
  folderId: string | null;
  title: string;
  body: string;
  /** SHA-256 of body; the compare-and-set anchor (ctx.expectedContentHash). */
  contentHash: string;
  rev: number;
  favorite: boolean;
  headVersionId: string | null;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
  trashedAt: number | null;
  /** Effective state: own trash or any ancestor folder trashed. */
  trashed: boolean;
}
export type NoteSummary = Omit<Note, 'body'>;
const omitBody = (n: Note): NoteSummary => {
  const s: Partial<Note> = { ...n };
  delete s.body;
  return s as NoteSummary;
};

interface Row {
  id: string;
  folder_id: string | null;
  title: string;
  body: string;
  content_hash: string;
  rev: number;
  favorite: number;
  head_version_id: string | null;
  created_at: number;
  updated_at: number;
  device_id: string;
  trashed_at: number | null;
  trash_batch_id: string | null;
}

const COLS = `id, folder_id, title, body, content_hash, rev, favorite, head_version_id,
  created_at, updated_at, device_id, trashed_at, trash_batch_id`;

const SUMMARY_COLS = COLS.replace(' body,', '');

const toNote = (r: Row, trashed: boolean): Note => ({
  id: r.id,
  folderId: r.folder_id,
  title: r.title,
  body: r.body,
  contentHash: r.content_hash,
  rev: r.rev,
  favorite: r.favorite === 1,
  headVersionId: r.head_version_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deviceId: r.device_id,
  trashedAt: r.trashed_at,
  trashed,
});

const id = z.string().min(1).max(64);
const title = z.string().max(1000);
const body = z.string().max(10_000_000);
const createIn = z.object({ title, body, folderId: id.nullish() }).strict();
const updateIn = z.object({ title: title.optional(), body: body.optional() }).strict();
const listIn = z
  .object({
    folderId: id.nullable().optional(),
    trashed: z.boolean().optional(),
    favorite: z.boolean().optional(),
    tagId: id.optional(),
    limit: z.number().int().min(1).max(100_000).optional(),
    cursor: z.object({ updatedAt: z.number().int(), id }).strict().optional(),
  })
  .strict();

export function createNotesApi(s: Store) {
  const load = (tx: Tx, noteId: string): Row | undefined =>
    tx.db.prepare(`SELECT ${COLS} FROM notes WHERE id = ?`).get(noteId) as Row | undefined;
  const reload = (tx: Tx, noteId: string): Result<Note> => {
    const r = load(tx, noteId);
    return r ? ok(toNote(r, noteIsTrashed(tx.db, r))) : err('not_found', 'note not found');
  };
  /** Live (not trashed, even via ancestors) note or an error. */
  const live = (
    tx: Tx,
    noteId: string,
    trashedCode: 'conflict' | 'trashed' = 'conflict',
  ): Result<Row> => {
    const r = load(tx, noteId);
    if (!r) return err('not_found', 'note not found');
    if (noteIsTrashed(tx.db, r)) return err(trashedCode, 'note is in the trash');
    return ok(r);
  };
  const folderOk = (tx: Tx, folderId: string | null | undefined): Result<void> => {
    if (folderId == null) return ok(undefined);
    const f = tx.db.prepare('SELECT 1 AS x FROM folders WHERE id = ?').get(folderId);
    return !f || folderIsTrashed(tx.db, folderId)
      ? err('not_found', 'folder not found')
      : ok(undefined);
  };

  function updateNote(ctx: Ctx, noteId: string, input: unknown, isSave: boolean): Result<Note> {
    const ni = parse(id, noteId);
    if (!ni.ok) return ni;
    const p = parse(updateIn, input);
    if (!p.ok) return p;
    return s.mutate(ctx, (tx) => {
      const n = live(tx, noteId, isSave ? 'trashed' : 'conflict');
      if (!n.ok) return n;
      const cur = n.value;
      const cas = tx.checkExpected(cur.content_hash);
      if (!cas.ok) return cas;
      if (isSave) {
        const m = tx.db
          .prepare('SELECT MAX(seq) AS m FROM drafts WHERE note_id = ?')
          .get(noteId) as {
          m: number | null;
        };
        if (m.m !== null) deleteDraftsUpTo(tx.db, noteId, m.m);
      } else if (tx.ctx.draftSeq !== undefined) deleteDraftsUpTo(tx.db, noteId, tx.ctx.draftSeq);
      const nt = p.value.title ?? cur.title;
      const nb = p.value.body ?? cur.body;
      if (nt === cur.title && nb === cur.body) return reload(tx, noteId);
      const h = sha256(nb);

      let reason: VersionReason | null = null;
      let baseVersionId: string | null = null;
      const headOf = (vid: string | null) =>
        vid
          ? (tx.db
              .prepare('SELECT body, content_hash, created_at FROM versions WHERE id = ?')
              .get(vid) as { body: string; content_hash: string; created_at: number } | undefined)
          : undefined;
      if (tx.ctx.actor) {
        const sn = snapshotNote(tx, noteId, 'agent'); // pre-write snapshot: agent undo = restoreVersion
        if (!sn.ok) return sn;
        baseVersionId = sn.value; // holds exactly the pre-write text
        reason = 'agent';
      } else {
        const head = headOf(cur.head_version_id);
        if (head?.content_hash === cur.content_hash) baseVersionId = cur.head_version_id;
        if (!head || tx.now - head.created_at >= VERSION_INTERVAL_MS) reason = 'edit';
        else if (changedChars(head.body, nb) > VERSION_CHARS) reason = 'size';
      }
      tx.db
        .prepare(
          `UPDATE notes SET title = ?, body = ?, content_hash = ?, rev = rev + 1, updated_at = ?
             WHERE id = ?`,
        )
        .run(nt, nb, h, tx.now, noteId);
      const head = tx.db
        .prepare('SELECT head_version_id AS h FROM notes WHERE id = ?')
        .get(noteId) as {
        h: string | null;
      };
      const v = reason
        ? insertVersion(
            tx,
            { id: noteId, head_version_id: head.h },
            { title: nt, body: nb, hash: h },
            reason,
          )
        : undefined; // throttled: the text is identified by contentHash; the body lives in notes
      const l = tx.log({
        entity: 'note',
        entityId: noteId,
        op: 'update',
        fields: nt !== cur.title ? { title: nt } : {},
        noteVersionId: v,
        baseVersionId: v ? baseVersionId : undefined,
        contentHash: h,
        baseContentHash: cur.content_hash,
      });
      return l.ok ? reload(tx, noteId) : l;
    });
  }

  return {
    create(ctx: Ctx, input: unknown): Result<Note> {
      const p = parse(createIn, input);
      if (!p.ok) return p;
      const { title: t, body: b, folderId } = p.value;
      return s.mutate(ctx, (tx) => {
        const f = folderOk(tx, folderId);
        if (!f.ok) return f;
        const nid = tx.ulid();
        const h = sha256(b);
        tx.db
          .prepare(
            `INSERT INTO notes(id, folder_id, title, body, content_hash, rev, favorite, head_version_id,
               created_at, updated_at, device_id) VALUES (?,?,?,?,?,1,0,NULL,?,?,?)`,
          )
          .run(nid, folderId ?? null, t, b, h, tx.now, tx.now, tx.deviceId);
        const v = insertVersion(
          tx,
          { id: nid, head_version_id: null },
          { title: t, body: b, hash: h },
          tx.ctx.actor ? 'agent' : 'edit',
        );
        const l = tx.log({
          entity: 'note',
          entityId: nid,
          op: 'create',
          fields: { title: t, folderId: folderId ?? null, favorite: false },
          noteVersionId: v,
          contentHash: h,
        });
        return l.ok ? reload(tx, nid) : l;
      });
    },

    get(noteId: string): Result<Note> {
      const ni = parse(id, noteId);
      if (!ni.ok) return ni;
      return safe(() => {
        const r = s.db.prepare(`SELECT ${COLS} FROM notes WHERE id = ?`).get(noteId) as
          Row | undefined;
        return r ? ok(toNote(r, noteIsTrashed(s.db, r))) : err('not_found', 'note not found');
      });
    },

    /**
     * Summaries (never bodies), newest update first. `folderId: null` = root only; omitted = all
     * folders. Page with `limit` and `cursor` = the last item's {updatedAt, id}.
     * No default limit (callers decide). Paging by updated_at is not a snapshot: a note edited mid-scan
     * moves to the front and can be skipped or repeated; callers needing completeness re-scan.
     */
    list(filter: unknown = {}): Result<NoteSummary[]> {
      const p = parse(listIn, filter);
      if (!p.ok) return p;
      const { folderId, trashed = false, favorite, tagId, limit, cursor } = p.value;
      return safe(() => {
        const tf = JSON.stringify([...trashedFolderIds(s.db)]);
        const where = [
          trashed
            ? '(trashed_at IS NOT NULL OR folder_id IN (SELECT value FROM json_each(?)))'
            : '(trashed_at IS NULL AND (folder_id IS NULL OR folder_id NOT IN (SELECT value FROM json_each(?))))',
        ];
        const args: unknown[] = [tf];
        if (folderId === null) where.push('folder_id IS NULL');
        else if (folderId !== undefined) {
          where.push('folder_id = ?');
          args.push(folderId);
        }
        if (favorite !== undefined) where.push(favorite ? 'favorite = 1' : 'favorite = 0');
        if (tagId !== undefined) {
          where.push('id IN (SELECT note_id FROM note_tags WHERE tag_id = ?)');
          args.push(tagId);
        }
        if (cursor) {
          where.push('(updated_at < ? OR (updated_at = ? AND id > ?))');
          args.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
        }
        const rows = s.db
          .prepare(
            `SELECT ${SUMMARY_COLS} FROM notes WHERE ${where.join(' AND ')}
             ORDER BY updated_at DESC, id${limit ? ' LIMIT ?' : ''}`,
          )
          .all(...args, ...(limit ? [limit] : [])) as Row[];
        return ok(rows.map((r) => omitBody(toNote({ ...r, body: '' }, trashed))));
      });
    },

    /**
     * Title-only input is a rename. A no-change update is a no-op: ok, no row, no version.
     * Note rows are state-based: a row that created a version carries `noteVersionId`; a throttled
     * one carries only `contentHash`/`baseContentHash` and sync sends the note's current body
     * (using versions.force(..., 'merge_base') when it needs a base). `baseVersionId` is only ever
     * the version whose content hash equals `baseContentHash`, or null.
     * `ctx.draftSeq` deletes that note's drafts up to the seq in this same transaction.
     */
    update(ctx: Ctx, noteId: string, input: unknown): Result<Note> {
      return updateNote(ctx, noteId, input, false);
    },

    /**
     * The editor's save: like update, but a trashed note is `trashed` (not `conflict`), and the
     * note's drafts up to MAX(seq) are deleted in the same transaction (a newer draft written later
     * has a higher seq and survives).
     */
    save(ctx: Ctx, noteId: string, input: unknown): Result<Note> {
      return updateNote(ctx, noteId, input, true);
    },

    move(ctx: Ctx, noteId: string, folderId: string | null): Result<Note> {
      const f = parse(z.tuple([id, id.nullable()]), [noteId, folderId]);
      if (!f.ok) return f;
      return s.mutate(ctx, (tx) => {
        const n = live(tx, noteId);
        if (!n.ok) return n;
        const fo = folderOk(tx, folderId);
        if (!fo.ok) return fo;
        if (n.value.folder_id === folderId) return reload(tx, noteId);
        tx.db
          .prepare('UPDATE notes SET folder_id = ?, updated_at = ? WHERE id = ?')
          .run(folderId, tx.now, noteId);
        const l = tx.log({ entity: 'note', entityId: noteId, op: 'move', fields: { folderId } });
        return l.ok ? reload(tx, noteId) : l;
      });
    },

    setFavorite(ctx: Ctx, noteId: string, favorite: boolean): Result<Note> {
      const f = parse(z.tuple([id, z.boolean()]), [noteId, favorite]);
      if (!f.ok) return f;
      return s.mutate(ctx, (tx) => {
        const n = live(tx, noteId);
        if (!n.ok) return n;
        if ((n.value.favorite === 1) === favorite) return reload(tx, noteId); // no-op: no row
        tx.db
          .prepare('UPDATE notes SET favorite = ?, updated_at = ? WHERE id = ?')
          .run(favorite ? 1 : 0, tx.now, noteId);
        const l = tx.log({ entity: 'note', entityId: noteId, op: 'update', fields: { favorite } });
        return l.ok ? reload(tx, noteId) : l;
      });
    },
  };
}
export type NotesApi = ReturnType<typeof createNotesApi>;
