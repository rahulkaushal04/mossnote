import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveTitle, openWorkspace, type Workspace } from '../../core/src/index.ts';
import { BASE_TIME, folderCountFor, folderPlan, genNote } from './text.ts';

export const DEFAULT_SEED = 20260101;
export const SIZES = { '1k': 1_000, '10k': 10_000, '100k': 100_000 } as const;
export type SizeName = keyof typeof SIZES;

export interface DatasetInfo {
  path: string;
  notes: number;
  seed: number;
  /** SHA-256 of the ordered logical export (notes, folders, tags); ids and device ids are excluded. */
  hash: string;
  generateSeconds: number;
}

interface Row {
  title: string;
  body: string;
  folder_id: string | null;
  favorite: number;
  created_at: number;
  trashed: number;
  id: string;
}

/**
 * Hash of the logical content, in a fixed order: folders by path, tags by name, notes by
 * (created_at, title). Random ULIDs are mapped to folder paths so two builds compare equal.
 */
export function logicalHash(ws: Workspace): string {
  const db = ws.store.db;
  const h = createHash('sha256');
  const folders = db.prepare('SELECT id, parent_id, name FROM folders').all() as {
    id: string;
    parent_id: string | null;
    name: string;
  }[];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (id: string | null): string => {
    const parts: string[] = [];
    for (
      let f = id ? byId.get(id) : undefined;
      f;
      f = f.parent_id ? byId.get(f.parent_id) : undefined
    )
      parts.unshift(f.name);
    return parts.join('/');
  };
  h.update(JSON.stringify(folders.map((f) => pathOf(f.id)).sort()));
  const tags = (
    db.prepare('SELECT name FROM tags ORDER BY name_key').all() as { name: string }[]
  ).map((t) => t.name);
  h.update(JSON.stringify(tags));
  const page = db.prepare(
    `SELECT id, title, body, folder_id, favorite, created_at, trashed_at IS NOT NULL AS trashed
     FROM notes WHERE created_at > ? ORDER BY created_at, id LIMIT 2000`,
  );
  const tagStmt = db.prepare(
    'SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.name_key',
  );
  for (let after = -1; ;) {
    const rows = page.all(after) as Row[];
    if (rows.length === 0) break;
    for (const n of rows) {
      const nt = (tagStmt.all(n.id) as { name: string }[]).map((t) => t.name);
      h.update(
        JSON.stringify([
          n.title,
          n.body,
          pathOf(n.folder_id),
          nt,
          n.favorite,
          n.created_at,
          n.trashed,
        ]),
      );
    }
    after = (rows[rows.length - 1] as Row).created_at;
  }
  return h.digest('hex');
}

/**
 * Writes `count` notes through the real core APIs (so every search trigger fires). Only the
 * durability pragmas are relaxed while generating (synchronous=OFF, no fullfsync): generation is a
 * one-off, and the timed benchmarks reopen the file with the production pragmas. Resumable: the note
 * count in the file says where to continue, and the last note's tags/favorite/trash are re-applied.
 */
export function populate(
  dbPath: string,
  count: number,
  seed: number,
  progress: (done: number) => void = () => {},
  /** Tests only: stop early, as if interrupted. */
  stopAfter = count,
): void {
  let now = BASE_TIME;
  const opened = openWorkspace(dbPath, { clock: { now: () => now } });
  if (!opened.ok) throw new Error(`open failed: ${opened.error.message}`);
  const ws = opened.value;
  try {
    ws.store.db.pragma('synchronous = OFF');
    ws.store.db.pragma('fullfsync = OFF');
    const must = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    };
    const ctx = { seed, total: count, folders: folderCountFor(count) };
    const plan = folderPlan(seed, ctx.folders);
    const existing = new Map(must(ws.folders.list()).map((f) => [`${f.parentId}/${f.name}`, f.id]));
    const folderIds: string[] = [];
    for (const f of plan) {
      const parent = f.parent < 0 ? null : (folderIds[f.parent] as string);
      const id =
        existing.get(`${parent}/${f.name}`) ??
        must(ws.folders.create({}, { name: f.name, parentId: parent })).id;
      folderIds.push(id);
    }
    const tagIds = new Map<string, string>();
    const tagId = (name: string): string => {
      let id = tagIds.get(name);
      if (!id) tagIds.set(name, (id = must(ws.tags.create({}, name)).id));
      return id;
    };
    const have = (ws.store.db.prepare('SELECT count(*) AS c FROM notes').get() as { c: number }).c;
    const start = Math.max(0, have - 1);
    for (let i = start; i < stopAfter; i++) {
      const spec = genNote(ctx, i);
      now = spec.createdAt;
      let id: string;
      if (i < have) {
        const row = ws.store.db
          .prepare('SELECT id FROM notes WHERE created_at = ?')
          .get(spec.createdAt) as { id: string } | undefined;
        if (!row) throw new Error('resume: last note missing');
        id = row.id;
      } else {
        id = must(
          ws.notes.create(
            {},
            {
              title: deriveTitle(spec.body),
              body: spec.body,
              folderId: spec.folder < 0 ? null : folderIds[spec.folder],
            },
          ),
        ).id;
      }
      for (const t of spec.tags) must(ws.tags.tagNote({}, id, tagId(t)));
      if (spec.favorite) must(ws.notes.setFavorite({}, id, true));
      if (spec.trashed) {
        const cur = must(ws.notes.get(id));
        if (!cur.trashedAt) must(ws.trash.trashNote({}, id));
      }
      if ((i + 1) % 500 === 0) progress(i + 1);
    }
    progress(count);
  } finally {
    ws.close();
  }
}

/** Cached on disk: `<dir>/ds-<n>-<seed>.sqlite` plus a `.json` marker written only when complete. */
export function ensureDataset(
  dir: string,
  count: number,
  seed = DEFAULT_SEED,
  log: (m: string) => void = () => {},
): DatasetInfo {
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `ds-${count}-${seed}`);
  const finalPath = `${base}.sqlite`;
  const marker = `${base}.json`;
  if (existsSync(marker) && existsSync(finalPath)) return JSON.parse(readFileSync(marker, 'utf8'));
  const partial = `${base}.partial.sqlite`;
  const t0 = Date.now();
  populate(partial, count, seed, (d) => {
    if (d % 5000 === 0)
      log(`generated ${d}/${count} notes (${Math.round((Date.now() - t0) / 1000)} s)`);
  });
  const opened = openWorkspace(partial);
  if (!opened.ok) throw new Error(opened.error.message);
  const hash = logicalHash(opened.value);
  opened.value.close();
  renameSync(partial, finalPath);
  const info: DatasetInfo = {
    path: finalPath,
    notes: count,
    seed,
    hash,
    generateSeconds: (Date.now() - t0) / 1000,
  };
  writeFileSync(marker, JSON.stringify(info, null, 2));
  return info;
}
