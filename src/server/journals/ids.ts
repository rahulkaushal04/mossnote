import { listSnapshots } from '../db/backup';
import { journalIds } from '../db/catalog';
import type { Config } from '../config';

/** A short, file-name-safe id from a journal's name. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return slug === '' ? 'journal' : slug;
}

/** An id for a new journal named `name`: not a journal that exists, and not one with snapshots. */
export function freeJournalId(
  config: Pick<Config, 'dataDir' | 'backupsDir'>,
  name: string,
): string {
  const taken = new Set(journalIds(config.dataDir));
  const base = slugify(name);
  // An id that already has snapshots (from a deleted journal) would adopt them.
  const free = (id: string) => !taken.has(id) && listSnapshots(config.backupsDir, id).length === 0;
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    if (free(id)) return id;
  }
}
