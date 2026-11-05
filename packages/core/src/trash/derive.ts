import type { z } from 'zod';
import { toAppError } from '../db/errors.ts';
import type { Db } from '../db/types.ts';
import { err, ok, type Result } from '../result.ts';

/** Shared internals for notes/folders/tags/trash/versions. */

/** Runs a read; thrown driver errors become Result errors. */
export function safe<T>(fn: () => Result<T>): Result<T> {
  try {
    return fn();
  } catch (e) {
    return toAppError(e);
  }
}

export function parse<S extends z.ZodType>(schema: S, v: unknown): Result<z.output<S>> {
  const p = schema.safeParse(v);
  return p.success ? ok(p.data) : err('validation', p.error.message, p.error);
}

export const DAY_MS = 86_400_000;
export const MAX_FOLDER_DEPTH = 50;

interface FolderRow {
  id: string;
  parent_id: string | null;
  trashed_at: number | null;
}

/**
 * Effective trash state is derived at read time: a folder is trashed when it, or any ancestor,
 * has trashed_at set. Descendants are never rewritten when a folder is trashed or restored.
 */
export function trashedFolderIds(db: Db): Set<string> {
  const rows = db.prepare('SELECT id, parent_id, trashed_at FROM folders').all() as FolderRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const memo = new Map<string, boolean>();
  const eff = (id: string): boolean => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    memo.set(id, false); // cycle guard; cycles cannot be created locally
    const r = byId.get(id);
    const v = !!r && (r.trashed_at !== null || (r.parent_id !== null && eff(r.parent_id)));
    memo.set(id, v);
    return v;
  };
  const out = new Set<string>();
  for (const r of rows) if (eff(r.id)) out.add(r.id);
  return out;
}

/** True when the folder or any ancestor is trashed. Missing folder counts as trashed. */
export function folderIsTrashed(db: Db, folderId: string): boolean {
  const q = db.prepare('SELECT parent_id, trashed_at FROM folders WHERE id = ?');
  let cur: string | null = folderId;
  for (let i = 0; cur !== null && i <= MAX_FOLDER_DEPTH + 50; i++) {
    const r = q.get(cur) as { parent_id: string | null; trashed_at: number | null } | undefined;
    if (!r || r.trashed_at !== null) return true;
    cur = r.parent_id;
  }
  return false;
}

export function noteIsTrashed(
  db: Db,
  n: { folder_id: string | null; trashed_at: number | null },
): boolean {
  return n.trashed_at !== null || (n.folder_id !== null && folderIsTrashed(db, n.folder_id));
}

/** Depth of a folder (root-level folder = 1; null = 0). */
export function depthOf(db: Db, folderId: string | null): number {
  const q = db.prepare('SELECT parent_id FROM folders WHERE id = ?');
  let d = 0;
  let cur = folderId;
  while (cur !== null && d < 1000) {
    d++;
    cur = (q.get(cur) as { parent_id: string | null } | undefined)?.parent_id ?? null;
  }
  return d;
}

/** The folder and all descendants with their depth relative to it (root = 1). */
export function subtree(db: Db, rootId: string): { id: string; d: number }[] {
  return db
    .prepare(
      `WITH RECURSIVE t(id, d) AS (
         SELECT id, 1 FROM folders WHERE id = ?
         UNION ALL SELECT f.id, t.d + 1 FROM folders f JOIN t ON f.parent_id = t.id WHERE t.d < 200)
       SELECT id, d FROM t`,
    )
    .all(rootId) as { id: string; d: number }[];
}
