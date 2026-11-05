import { join } from 'node:path';
import type { Result } from '../../src/result.ts';
import { createFoldersApi } from '../../src/folders/folders.ts';
import { createNotesApi } from '../../src/notes/notes.ts';
import { createTagsApi } from '../../src/tags/tags.ts';
import { createTrashApi } from '../../src/trash/trash.ts';
import { createVersionsApi } from '../../src/versions/versions.ts';
import type { OpenOptions } from '../../src/store/store.ts';
import { open, tmp } from '../store/helpers.ts';

export const MIN = 60_000;
export const DAY = 86_400_000;

export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

/** A fresh workspace with every API and a controllable clock. */
export function setup(opts: OpenOptions = {}) {
  const clock = { t: 1_700_000_000_000 };
  const store = open(join(tmp(), 'w.db'), { clock: { now: () => clock.t }, ...opts });
  return {
    clock,
    store,
    notes: createNotesApi(store),
    folders: createFoldersApi(store),
    tags: createTagsApi(store),
    trash: createTrashApi(store),
    versions: createVersionsApi(store),
    logCount: () =>
      (store.db.prepare('SELECT count(*) AS n FROM change_log').get() as { n: number }).n,
    tombstones: () =>
      (
        store.db.prepare('SELECT entity_id FROM tombstones ORDER BY entity_id').all() as {
          entity_id: string;
        }[]
      ).map((r) => r.entity_id),
    lastRow: () => {
      const rows = unwrap(store.changelog.read({ limit: 10000 }));
      return rows[rows.length - 1]!;
    },
  };
}
export type W = ReturnType<typeof setup>;

/** Every text/blob cell of every table, joined: for "no recoverable body" assertions. */
export function dumpAllText(w: W): string {
  const tables = w.store.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return tables
    .map(({ name }) => JSON.stringify(w.store.db.prepare(`SELECT * FROM "${name}"`).all()))
    .join('\n');
}
