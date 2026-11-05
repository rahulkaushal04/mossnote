import { z } from 'zod';
import { redactFields } from '../changelog/append.ts';
import { clearOrphanText } from '../attachments/orphan.ts';
import { getMeta, setMeta } from '../db/meta.ts';
import { err, ok, type Result } from '../result.ts';
import type { Ctx, Store, Tx } from '../store/store.ts';
import { DAY_MS, folderIsTrashed, parse, safe, subtree } from './derive.ts';

export interface TrashItem {
  batchId: string;
  entity: 'note' | 'folder';
  id: string;
  label: string;
  trashedAt: number;
  expiresAt: number;
  /** When the user was shown the expiry notice; null = not yet. */
  noticeAt: number | null;
}

const id = z.string().min(1).max(64);
const confirm = z.object({ confirmed: z.literal(true) }).strict();
const DEFAULT_RETENTION_DAYS = 30;

export function createTrashApi(s: Store) {
  const retentionDays = (): number => {
    const n = Number(getMeta(s.db, 'trash_retention_days'));
    return Number.isFinite(n) && n >= 1 ? n : DEFAULT_RETENTION_DAYS;
  };

  /** Purged text lives on in the WAL's old pages until a TRUNCATE checkpoint. Best effort: the purge is already committed. */
  const scrubWal = () => {
    try {
      s.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* closing the workspace retries */
    }
  };

  const findBatch = (
    tx: Tx,
    batchId: string,
  ): { entity: 'note' | 'folder'; id: string } | undefined => {
    const f = tx.db.prepare('SELECT id FROM folders WHERE trash_batch_id = ?').get(batchId) as
      { id: string } | undefined;
    if (f) return { entity: 'folder', id: f.id };
    const n = tx.db.prepare('SELECT id FROM notes WHERE trash_batch_id = ?').get(batchId) as
      { id: string } | undefined;
    return n ? { entity: 'note', id: n.id } : undefined;
  };

  /** Trash is one change-log row on the item; its subtree is trashed only by derivation. */
  const trash = (
    entity: 'note' | 'folder',
    ctx: Ctx,
    itemId: string,
  ): Result<{ batchId: string }> => {
    const p = parse(id, itemId);
    if (!p.ok) return p;
    return s.mutate(ctx, (tx) => {
      const table = entity === 'note' ? 'notes' : 'folders';
      const row = tx.db
        .prepare(
          `SELECT ${entity === 'note' ? 'folder_id' : 'parent_id'} AS p, trashed_at FROM ${table} WHERE id = ?`,
        )
        .get(itemId) as { p: string | null; trashed_at: number | null } | undefined;
      if (!row) return err('not_found', `${entity} not found`);
      const inTrash =
        row.trashed_at !== null ||
        (entity === 'folder'
          ? folderIsTrashed(tx.db, itemId)
          : row.p !== null && folderIsTrashed(tx.db, row.p));
      if (inTrash) return err('conflict', `${entity} is already in the trash`);
      const batchId = tx.ulid();
      tx.db
        .prepare(
          `UPDATE ${table} SET trashed_at = ?, trash_batch_id = ?, trash_notice_at = NULL WHERE id = ?`,
        )
        .run(tx.now, batchId, itemId);
      const l = tx.log({ entity, entityId: itemId, op: 'trash', fields: { batchId } });
      return l.ok ? ok({ batchId }) : l;
    });
  };

  /** Everything a purge removes, captured now so replay removes exactly these ids. */
  const collect = (tx: Tx, entity: 'note' | 'folder', rootId: string) => {
    if (entity === 'note') return { folders: [] as string[], notes: [rootId] };
    const sub = subtree(tx.db, rootId).sort((a, b) => b.d - a.d); // deepest first for FK order
    const folders = sub.map((x) => x.id);
    const q = tx.db.prepare('SELECT id FROM notes WHERE folder_id = ?');
    const notes = folders.flatMap((f) => (q.all(f) as { id: string }[]).map((r) => r.id));
    return { folders, notes };
  };

  const purgeRoot = (
    tx: Tx,
    entity: 'note' | 'folder',
    rootId: string,
  ): Result<{ purged: number }> => {
    const { folders, notes } = collect(tx, entity, rootId);
    // Explicit deletes: nothing depends on cascade settings to remove a body.
    // Attachment references go first (their rows name the file); the blob itself stays until Cleanup (M10).
    const refQ = tx.db.prepare('SELECT id, sha256 FROM note_attachments WHERE note_id = ?');
    const refs = notes.flatMap((n) => refQ.all(n) as { id: string; sha256: string }[]);
    const del = [
      'DELETE FROM note_attachments WHERE note_id = ?',
      'DELETE FROM base_holds WHERE version_id IN (SELECT id FROM versions WHERE note_id = ?)',
      'DELETE FROM versions WHERE note_id = ?',
      'DELETE FROM drafts WHERE note_id = ?',
      'DELETE FROM note_tags WHERE note_id = ?',
      'DELETE FROM notes WHERE id = ?',
    ].map((q) => tx.db.prepare(q));
    for (const n of notes) for (const q of del) q.run(n);
    const delFolder = tx.db.prepare('DELETE FROM folders WHERE id = ?');
    for (const f of folders) delFolder.run(f);
    // The last reference to a PDF is gone: its extracted text must not outlive the purge.
    clearOrphanText(
      tx.db,
      refs.map((r) => r.sha256),
    );
    const ids = [...folders, ...notes];
    const refIds = refs.map((r) => r.id);
    redactFields(tx.db, [...ids, ...refIds]); // exact-id lookups, including the notes' note_tag rows
    const l = tx.log({
      entity,
      entityId: rootId,
      op: 'purge',
      purged: [
        ...folders.map((x) => ({ entity: 'folder' as const, id: x })),
        ...notes.map((x) => ({ entity: 'note' as const, id: x })),
        ...refIds.map((x) => ({ entity: 'attachment_ref' as const, id: x })),
      ],
    });
    return l.ok ? ok({ purged: ids.length }) : l;
  };

  const list = (): Result<TrashItem[]> => {
    return safe(() => {
      const days = retentionDays();
      const rows = [
        ...(s.db
          .prepare(
            "SELECT 'note' AS entity, id, title AS label, trashed_at, trash_batch_id, trash_notice_at FROM notes WHERE trashed_at IS NOT NULL",
          )
          .all() as Raw[]),
        ...(s.db
          .prepare(
            "SELECT 'folder' AS entity, id, name AS label, trashed_at, trash_batch_id, trash_notice_at FROM folders WHERE trashed_at IS NOT NULL",
          )
          .all() as Raw[]),
      ];
      return ok(
        rows
          .map((r) => ({
            batchId: r.trash_batch_id,
            entity: r.entity,
            id: r.id,
            label: r.label,
            trashedAt: r.trashed_at,
            expiresAt: r.trashed_at + days * DAY_MS,
            noticeAt: r.trash_notice_at,
          }))
          .sort((a, b) => a.trashedAt - b.trashedAt || a.id.localeCompare(b.id)),
      );
    });
  };

  return {
    trashNote: (ctx: Ctx, noteId: string) => trash('note', ctx, noteId),
    trashFolder: (ctx: Ctx, folderId: string) => trash('folder', ctx, folderId),

    /** If the item's parent is trashed now, it returns at top level (same single row). */
    restoreBatch(ctx: Ctx, batchId: string): Result<{ entity: 'note' | 'folder'; id: string }> {
      const p = parse(id, batchId);
      if (!p.ok) return p;
      return s.mutate(ctx, (tx) => {
        const b = findBatch(tx, batchId);
        if (!b) return err('not_found', 'trash batch not found');
        const table = b.entity === 'note' ? 'notes' : 'folders';
        const col = b.entity === 'note' ? 'folder_id' : 'parent_id';
        const row = tx.db.prepare(`SELECT ${col} AS p FROM ${table} WHERE id = ?`).get(b.id) as {
          p: string | null;
        };
        const orphan = row.p !== null && folderIsTrashed(tx.db, row.p);
        tx.db
          .prepare(
            `UPDATE ${table} SET trashed_at = NULL, trash_batch_id = NULL, trash_notice_at = NULL,
               ${orphan ? `${col} = NULL,` : ''} updated_at = ? WHERE id = ?`,
          )
          .run(tx.now, b.id);
        const fields: Record<string, unknown> = { batchId };
        if (orphan) fields[b.entity === 'note' ? 'folderId' : 'parentId'] = null;
        const l = tx.log({ entity: b.entity, entityId: b.id, op: 'restore', fields });
        return l.ok ? ok(b) : l;
      });
    },

    /** Explicit user action. One purge row with every purged id; one tombstone per id. */
    purgeBatch(ctx: Ctx, batchId: string, opts: unknown): Result<{ purged: number }> {
      const c = parse(confirm, opts);
      if (!c.ok) return c;
      const p = parse(id, batchId);
      if (!p.ok) return p;
      const r = s.mutate(ctx, (tx) => {
        const b = findBatch(tx, batchId);
        return b ? purgeRoot(tx, b.entity, b.id) : err('not_found', 'trash batch not found');
      });
      if (r.ok) scrubWal();
      return r;
    },

    list,

    /** Items that expire within `withinDays` from now (including already-expired ones). */
    listExpiring(withinDays: number): Result<TrashItem[]> {
      const d = parse(z.number().min(0).max(3650), withinDays);
      if (!d.ok) return d;
      const all = list();
      if (!all.ok) return all;
      const horizon = s.clock.now() + d.value * DAY_MS;
      return ok(all.value.filter((i) => i.expiresAt <= horizon));
    },

    /** Call after the user has been shown the notice. Not a change-log action. */
    recordNotice(batchIds: unknown): Result<number> {
      const b = parse(z.array(id).max(10_000), batchIds);
      if (!b.ok) return b;
      return s.mutate({}, (tx) => {
        let n = 0;
        for (const t of ['notes', 'folders'])
          for (const batch of b.value)
            n += tx.db
              .prepare(
                `UPDATE ${t} SET trash_notice_at = ? WHERE trash_batch_id = ? AND trash_notice_at IS NULL`,
              )
              .run(tx.now, batch).changes;
        return ok(n);
      });
    },

    /**
     * Permanently deletes batches whose retention elapsed AND whose notice was recorded. A folder
     * is skipped while anything trashed inside it has not had its own notice (its purge would take
     * that item with it). One purge row per batch. Stops at the first failure.
     */
    purgeExpired(ctx: Ctx = {}): Result<{ batches: string[] }> {
      const due = safe(() => {
        const cutoff = s.clock.now() - retentionDays() * DAY_MS;
        const q = (t: string) =>
          s.db
            .prepare(
              `SELECT id, trash_batch_id AS b FROM ${t} WHERE trashed_at <= ? AND trash_notice_at IS NOT NULL ORDER BY trashed_at, id`,
            )
            .all(cutoff) as { id: string; b: string }[];
        return ok([
          ...q('folders').map((r) => ({ entity: 'folder' as const, ...r })),
          ...q('notes').map((r) => ({ entity: 'note' as const, ...r })),
        ]);
      });
      if (!due.ok) return due;
      const done: string[] = [];
      // One index optimize + WAL checkpoint for the whole batch, not one per purge commit.
      return s.batch((): Result<{ batches: string[] }> => {
        for (const item of due.value) {
          const r = s.mutate(ctx, (tx) => {
            const still = tx.db
              .prepare(
                `SELECT 1 AS x FROM ${item.entity === 'note' ? 'notes' : 'folders'} WHERE id = ? AND trash_batch_id = ?`,
              )
              .get(item.id, item.b);
            if (!still) return ok(false); // already removed with an expired ancestor
            if (item.entity === 'folder') {
              const sub = subtree(tx.db, item.id).map((x) => x.id);
              const unnoticed = (sql: string) => sub.some((f) => tx.db.prepare(sql).get(f, item.id));
              if (
                unnoticed(
                  "SELECT 1 AS x FROM notes WHERE folder_id = ? AND trashed_at IS NOT NULL AND trash_notice_at IS NULL AND ? <> ''",
                ) ||
                unnoticed(
                  'SELECT 1 AS x FROM folders WHERE id = ? AND id <> ? AND trashed_at IS NOT NULL AND trash_notice_at IS NULL',
                )
              )
                return ok(false);
            }
            const p = purgeRoot(tx, item.entity, item.id);
            return p.ok ? ok(true) : p;
          });
          if (!r.ok) return r;
          if (r.value) done.push(item.b);
        }
        return ok({ batches: done });
      });
    },

    setRetentionDays(days: unknown): Result<void> {
      const d = parse(z.number().int().min(1).max(3650), days);
      if (!d.ok) return d;
      return s.mutate({}, (tx) => {
        setMeta(tx.db, 'trash_retention_days', String(d.value));
        return ok(undefined);
      });
    },
  };
}
export type TrashApi = ReturnType<typeof createTrashApi>;

interface Raw {
  entity: 'note' | 'folder';
  id: string;
  label: string;
  trashed_at: number;
  trash_batch_id: string;
  trash_notice_at: number | null;
}
