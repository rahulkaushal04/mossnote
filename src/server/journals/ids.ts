import { pickFreeJournalId } from '@shared/journalId';
import { listSnapshots } from '../db/backup';
import { journalIds } from '../db/catalog';
import type { Config } from '../config';

/** An id for a new journal named `name`: not a journal that exists, and not one with snapshots. */
export function freeJournalId(
  config: Pick<Config, 'dataDir' | 'backupsDir'>,
  name: string,
): string {
  const taken = new Set(journalIds(config.dataDir));
  // An id that already has snapshots (from a deleted journal) would adopt them.
  return pickFreeJournalId(
    name,
    (id) => !taken.has(id) && listSnapshots(config.backupsDir, id).length === 0,
  );
}
