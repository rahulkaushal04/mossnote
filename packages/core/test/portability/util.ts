import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach } from 'vitest';
import type { PortabilityOptions } from '../../src/portability/index.ts';
import type { Result } from '../../src/result.ts';
import { openWorkspace, type Workspace } from '../../src/workspace.ts';
import { tmp } from '../store/helpers.ts';

export function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
export const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const T0 = 1_700_000_000_000;
/** Cheap scrypt and tiny chunks so encryption tests stay fast and exercise several chunks. */
export const FAST_CRYPTO = { logN: 14, chunkSize: 1024 };

const live: Workspace[] = [];
afterEach(() => {
  for (const w of live.splice(0)) w.close();
});

export interface Fx {
  w: Workspace;
  dir: string;
  path: string;
  clock: { t: number };
}
export function openFx(o: { dir?: string; portability?: PortabilityOptions; clock?: { t: number } } = {}): Fx {
  const clock = o.clock ?? { t: T0 };
  const dir = o.dir ?? tmp();
  const path = join(dir, 'w.db');
  const w = must(
    openWorkspace(path, {
      clock: { now: () => clock.t },
      attachments: { pdf: null },
      portability: { crypto: FAST_CRYPTO, ...o.portability },
    }),
  );
  live.push(w);
  return { w, dir, path, clock };
}
export function closeFx(f: Fx): void {
  const i = live.indexOf(f.w);
  if (i >= 0) live.splice(i, 1);
  must(f.w.close());
}

/** Notes (some in folders, with tags and favorites), deterministic. */
export function seed(w: Workspace, n: number, withFolders = true): { folderIds: string[]; noteIds: string[] } {
  const folderIds: string[] = [];
  if (withFolders) {
    const a = must(w.folders.create({}, { name: 'Projects' }));
    const b = must(w.folders.create({}, { name: 'Deep', parentId: a.id }));
    folderIds.push(a.id, b.id);
  }
  const tags = ['alpha', 'Beta'].map((t) => must(w.tags.create({}, t)));
  const noteIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const folderId = withFolders && i % 3 !== 0 ? folderIds[i % 2]! : null;
    const note = must(
      w.notes.create({}, { title: `Note ${i}`, body: `# Note ${i}\nbody ${i}\n`, folderId }),
    );
    noteIds.push(note.id);
    if (i % 4 === 0) must(w.tags.tagNote({}, note.id, tags[i % 2]!.id));
    if (i % 5 === 0) must(w.notes.setFavorite({}, note.id, true));
  }
  return { folderIds, noteIds };
}

/** path -> sha256 of every file under dir (directories as empty entries). */
export function treeHash(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const rel = relative(dir, p);
      const st = lstatSync(p); // never follow links, never read a FIFO
      if (st.isSymbolicLink()) out[rel] = `link:${readlinkSync(p)}`;
      else if (st.isDirectory()) {
        out[`${rel}/`] = '';
        walk(p);
      } else if (st.isFile()) out[rel] = sha(readFileSync(p));
      else out[rel] = 'special';
    }
  };
  walk(dir);
  return out;
}

export const write = (dir: string, rel: string, data: string | Uint8Array): string => {
  const p = join(dir, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, data);
  return p;
};

export const count = (w: Workspace, table: string): number =>
  (w.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/** The comparable essence of every live note: folder path, title, body, tags, favorite, timestamps. */
export function snapshotNotes(w: Workspace, rootFolderName?: string): string[] {
  const rows = w.store.db
    .prepare('SELECT id, folder_id, title, body, favorite, created_at, updated_at FROM notes WHERE trashed_at IS NULL')
    .all() as { id: string; folder_id: string | null; title: string; body: string; favorite: number; created_at: number; updated_at: number }[];
  const folders = new Map(
    (w.store.db.prepare('SELECT id, parent_id, name FROM folders').all() as { id: string; parent_id: string | null; name: string }[]).map((f) => [f.id, f]),
  );
  const pathOf = (id: string | null): string => {
    const parts: string[] = [];
    for (let cur = id; cur; ) {
      const f = folders.get(cur)!;
      parts.unshift(f.name);
      cur = f.parent_id;
    }
    if (rootFolderName && parts[0] === rootFolderName) parts.shift();
    return parts.join('/');
  };
  const tagQ = w.store.db.prepare(
    'SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name_key',
  );
  return rows
    .map((r) =>
      JSON.stringify([
        pathOf(r.folder_id),
        r.title,
        r.body,
        (tagQ.all(r.id) as { name: string }[]).map((t) => t.name),
        r.favorite,
        r.created_at,
        r.updated_at,
      ]),
    )
    .sort();
}

export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('payload-of-a-png-for-portability-tests'),
]);
