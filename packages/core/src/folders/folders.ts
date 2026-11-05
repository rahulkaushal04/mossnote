import { z } from 'zod';
import { err, ok, type Result } from '../result.ts';
import type { Ctx, Store, Tx } from '../store/store.ts';
import {
  depthOf,
  folderIsTrashed,
  MAX_FOLDER_DEPTH,
  parse,
  safe,
  subtree,
  trashedFolderIds,
} from '../trash/derive.ts';

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
  trashedAt: number | null;
  /** Effective state: own trash or any ancestor trashed. */
  trashed: boolean;
}

interface Row {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: number;
  updated_at: number;
  device_id: string;
  trashed_at: number | null;
}
const COLS = 'id, parent_id, name, created_at, updated_at, device_id, trashed_at';
const toFolder = (r: Row, trashed: boolean): Folder => ({
  id: r.id,
  parentId: r.parent_id,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deviceId: r.device_id,
  trashedAt: r.trashed_at,
  trashed,
});

const name = z.string().trim().min(1).max(255);
const id = z.string().min(1).max(64);
const createIn = z.object({ name, parentId: id.nullish() }).strict();
const listIn = z
  .object({ parentId: id.nullable().optional(), trashed: z.boolean().optional() })
  .strict();

export function createFoldersApi(s: Store) {
  const load = (tx: Tx, fid: string): Row | undefined =>
    tx.db.prepare(`SELECT ${COLS} FROM folders WHERE id = ?`).get(fid) as Row | undefined;
  const reload = (tx: Tx, fid: string): Result<Folder> => {
    const r = load(tx, fid);
    return r ? ok(toFolder(r, folderIsTrashed(tx.db, fid))) : err('not_found', 'folder not found');
  };
  const live = (tx: Tx, fid: string): Result<Row> => {
    const r = load(tx, fid);
    if (!r) return err('not_found', 'folder not found');
    return folderIsTrashed(tx.db, fid) ? err('conflict', 'folder is in the trash') : ok(r);
  };
  const parentOk = (tx: Tx, parentId: string | null): Result<void> =>
    parentId === null || (load(tx, parentId) && !folderIsTrashed(tx.db, parentId))
      ? ok(undefined)
      : err('not_found', 'parent folder not found');

  return {
    create(ctx: Ctx, input: unknown): Result<Folder> {
      const p = parse(createIn, input);
      if (!p.ok) return p;
      const parentId = p.value.parentId ?? null;
      return s.mutate(ctx, (tx) => {
        const po = parentOk(tx, parentId);
        if (!po.ok) return po;
        if (depthOf(tx.db, parentId) + 1 > MAX_FOLDER_DEPTH)
          return err('validation', `folders nest at most ${MAX_FOLDER_DEPTH} deep`);
        const fid = tx.ulid();
        tx.db
          .prepare(
            'INSERT INTO folders(id, parent_id, name, created_at, updated_at, device_id) VALUES (?,?,?,?,?,?)',
          )
          .run(fid, parentId, p.value.name, tx.now, tx.now, tx.deviceId);
        const l = tx.log({
          entity: 'folder',
          entityId: fid,
          op: 'create',
          fields: { name: p.value.name, parentId },
        });
        return l.ok ? reload(tx, fid) : l;
      });
    },

    rename(ctx: Ctx, folderId: string, newName: unknown): Result<Folder> {
      const n = parse(z.tuple([id, name]), [folderId, newName]);
      if (!n.ok) return n;
      const nm = n.value[1];
      return s.mutate(ctx, (tx) => {
        const f = live(tx, folderId);
        if (!f.ok) return f;
        if (f.value.name === nm) return reload(tx, folderId);
        tx.db
          .prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?')
          .run(nm, tx.now, folderId);
        const l = tx.log({
          entity: 'folder',
          entityId: folderId,
          op: 'update',
          fields: { name: nm },
        });
        return l.ok ? reload(tx, folderId) : l;
      });
    },

    /** Rejects self/descendant targets (cycle) and anything that would exceed depth 50. */
    move(ctx: Ctx, folderId: string, parentId: string | null): Result<Folder> {
      const pp = parse(z.tuple([id, id.nullable()]), [folderId, parentId]);
      if (!pp.ok) return pp;
      return s.mutate(ctx, (tx) => {
        const f = live(tx, folderId);
        if (!f.ok) return f;
        const po = parentOk(tx, parentId);
        if (!po.ok) return po;
        const sub = subtree(tx.db, folderId);
        if (parentId !== null && sub.some((x) => x.id === parentId))
          return err('validation', 'cannot move a folder under itself or its descendant');
        const height = Math.max(...sub.map((x) => x.d));
        if (depthOf(tx.db, parentId) + height > MAX_FOLDER_DEPTH)
          return err('validation', `folders nest at most ${MAX_FOLDER_DEPTH} deep`);
        if (f.value.parent_id === parentId) return reload(tx, folderId);
        tx.db
          .prepare('UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?')
          .run(parentId, tx.now, folderId);
        const l = tx.log({
          entity: 'folder',
          entityId: folderId,
          op: 'move',
          fields: { parentId },
        });
        return l.ok ? reload(tx, folderId) : l;
      });
    },

    get(folderId: string): Result<Folder> {
      const p = parse(id, folderId);
      if (!p.ok) return p;
      return safe(() => {
        const r = s.db.prepare(`SELECT ${COLS} FROM folders WHERE id = ?`).get(folderId) as
          Row | undefined;
        return r
          ? ok(toFolder(r, folderIsTrashed(s.db, folderId)))
          : err('not_found', 'folder not found');
      });
    },

    /** `parentId: null` = top level; omitted = all. Default shows only non-trashed folders. */
    list(filter: unknown = {}): Result<Folder[]> {
      const p = parse(listIn, filter);
      if (!p.ok) return p;
      const { parentId, trashed = false } = p.value;
      return safe(() => {
        const rows = s.db.prepare(`SELECT ${COLS} FROM folders ORDER BY name, id`).all() as Row[];
        const tf = trashedFolderIds(s.db);
        return ok(
          rows
            .filter((r) => parentId === undefined || r.parent_id === parentId)
            .map((r) => toFolder(r, tf.has(r.id)))
            .filter((f) => f.trashed === trashed),
        );
      });
    },
  };
}
export type FoldersApi = ReturnType<typeof createFoldersApi>;
