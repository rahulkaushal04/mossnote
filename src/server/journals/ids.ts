import fs from 'node:fs';
import { pickFreeJournalId } from '@shared/journalId';
import { journalIds } from '../db/catalog';
import { journalOfSnapshotName } from '../db/snapshots';
import type { Config } from '../config';

/**
 * The id of the existing journal that `wanted` names: an exact match first, then one that differs
 * only in case. macOS and Windows treat `Work.db` and `work.db` as one file, so the id has to be
 * the one the file is listed under or its snapshots and lock would be named differently.
 */
export function resolveJournalId(ids: readonly string[], wanted: string): string | null {
  if (ids.includes(wanted)) return wanted;
  const lower = wanted.toLowerCase();
  return ids.find((id) => id.toLowerCase() === lower) ?? null;
}

/** The journal ids that have snapshot files in `backupsDir`, as the files name them. */
function snapshotOwners(backupsDir: string): string[] {
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .map((name) => journalOfSnapshotName(name))
    .filter((owner): owner is string => owner !== null);
}

/**
 * An id for a new journal named `name`: not a journal that exists, and not one with snapshots.
 * Ids are compared without regard to case, so the new files can never be the same files as
 * another journal's on a file system that ignores case.
 */
export function freeJournalId(
  config: Pick<Config, 'dataDir' | 'backupsDir'>,
  name: string,
): string {
  const lower = (id: string) => id.toLowerCase();
  const taken = new Set(journalIds(config.dataDir).map(lower));
  // An id that already has snapshots (from a deleted journal) would adopt them.
  const withSnapshots = new Set(snapshotOwners(config.backupsDir).map(lower));
  return pickFreeJournalId(name, (id) => !taken.has(lower(id)) && !withSnapshots.has(lower(id)));
}
