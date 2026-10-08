import fs from 'node:fs';
import { journalPaths } from '../journals/paths';
import type { Storage } from '../services/storage';
import { createFileSnapshotStore } from './backup';

/** The data folder as {@link Storage}: one `<id>.db` per journal, snapshots in `backupsDir`. */
export function createFolderStorage(folders: { dataDir: string; backupsDir: string }): Storage {
  const { dataDir, backupsDir } = folders;
  return {
    snapshots: createFileSnapshotStore(backupsDir),
    describe(journal) {
      const { dbPath } = journalPaths(dataDir, journal);
      let databaseBytes = 0;
      try {
        databaseBytes = fs.statSync(dbPath).size;
      } catch {
        // In-memory databases (tests) have no file.
      }
      return {
        location: { kind: 'folder', dataDir, backupsDir, databasePath: dbPath },
        databaseBytes,
      };
    },
  };
}
