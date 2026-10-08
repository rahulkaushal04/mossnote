import {
  nextSnapshotSequence,
  parseSnapshotName,
  snapshotName,
  snapshotsToPrune,
  sortSnapshots,
  type Snapshot,
  type SnapshotStore,
} from '@server/db/snapshots';
import type { Catalog } from './catalog';
import { snapshotFile } from './names';
import type { FilePool } from './pool/types';

/**
 * Snapshots in browser storage: the {@link SnapshotStore} of the browser runtime. Each snapshot
 * is a database file in the pool; the catalog remembers its size. Naming, numbering and
 * retention are the rules in `db/snapshots.ts`, the same as for the Node server's files.
 */
export function createBrowserSnapshotStore(pool: FilePool, catalog: Catalog): SnapshotStore {
  const list = (journal: string): Snapshot[] => {
    const found: Snapshot[] = [];
    for (const { name, size } of catalog.snapshots(journal)) {
      const parsed = parseSnapshotName(journal, name);
      if (!parsed) continue;
      found.push({
        name,
        path: snapshotFile(name),
        reason: parsed.reason,
        takenAt: parsed.takenAt,
        size,
      });
    }
    return sortSnapshots(journal, found);
  };

  const remove = (snapshot: Snapshot) => {
    pool.remove(snapshot.path);
    catalog.removeSnapshot(snapshot.name);
  };

  return {
    list,
    async create({ sqlite, journal, reason, clock, autoKeep }) {
      const at = clock.now();
      const sequence = nextSnapshotSequence(journal, list(journal), reason, at);
      const name = snapshotName(journal, at, reason, sequence);
      const path = snapshotFile(name);

      await sqlite.backup(path);
      catalog.addSnapshot({ name, journal, size: pool.read(path).length });

      for (const old of snapshotsToPrune(list(journal), autoKeep)) remove(old);
      const made = list(journal).find((snapshot) => snapshot.name === name);
      if (!made) throw new Error(`Snapshot ${name} was created but could not be listed.`);
      return made;
    },
    delete(journal, name) {
      const snapshot = list(journal).find((candidate) => candidate.name === name);
      if (!snapshot) return false;
      remove(snapshot);
      return true;
    },
  };
}
