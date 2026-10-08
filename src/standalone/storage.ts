import type { Sqlite } from '@server/db/types';
import type { Storage } from '@server/services/storage';
import type { SnapshotStore } from '@server/db/snapshots';

/**
 * Browser storage as {@link Storage}. The size of a journal's database is read from SQLite
 * (pages times page size), because the pool has no file sizes.
 */
export function createBrowserStorage(options: {
  snapshots: SnapshotStore;
  /** The open journal's id and connection, or null when none is open. */
  open: () => { id: string; sqlite: Sqlite } | null;
}): Storage {
  const { snapshots, open } = options;
  return {
    snapshots,
    describe(journal) {
      const current = open();
      const pages = current?.id === journal ? current.sqlite : null;
      const databaseBytes = pages
        ? Number(pages.pragma('page_count', { simple: true })) *
          Number(pages.pragma('page_size', { simple: true }))
        : 0;
      return { location: { kind: 'browser' }, databaseBytes };
    },
  };
}
