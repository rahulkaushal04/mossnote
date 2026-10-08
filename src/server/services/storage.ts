import type { StorageLocation } from '@shared/types';
import type { SnapshotStore } from '../db/snapshots';

/** Where one journal's data is kept and how big it is, for Settings → Data. */
export interface StorageDescription {
  location: StorageLocation;
  /** Size of the journal's database in bytes; 0 when there is no file (an in-memory database). */
  databaseBytes: number;
}

/**
 * Where journals and their snapshots are kept. The Node server keeps them in a folder
 * (`db/folderStorage.ts`); the browser runtime keeps them in the browser's own storage. Services
 * use this instead of touching the file system, so they run unchanged in both.
 */
export interface Storage {
  readonly snapshots: SnapshotStore;
  describe(journal: string): StorageDescription;
}

/** For a context that never reads or writes snapshots or storage facts. Using it throws. */
export const noStorage: Storage = {
  snapshots: {
    list: () => {
      throw new Error('This context has no storage.');
    },
    create: () => Promise.reject(new Error('This context has no storage.')),
    delete: () => {
      throw new Error('This context has no storage.');
    },
  },
  describe: () => {
    throw new Error('This context has no storage.');
  },
};
