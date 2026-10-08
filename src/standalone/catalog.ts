import type { Sqlite } from '@server/db/types';
import { snapshotFile, snapshotNameOfFile } from './names';
import type { FilePool } from './pool/types';

/**
 * The catalog: a small database of the things the pool's file system cannot say about itself.
 * It remembers which journal is open, and how big each snapshot is (the pool has no file sizes).
 * It is kept open for as long as the runtime lives.
 */

const ACTIVE_JOURNAL_KEY = 'active-journal';

export interface SnapshotRecord {
  name: string;
  journal: string;
  size: number;
}

export interface Catalog {
  activeJournal(): string | null;
  setActiveJournal(id: string | null): void;
  snapshots(journal: string): SnapshotRecord[];
  addSnapshot(record: SnapshotRecord): void;
  removeSnapshot(name: string): void;
  close(): void;
}

function ensureTables(sqlite: Sqlite): void {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS snapshot (
       name TEXT PRIMARY KEY, journal TEXT NOT NULL, size INTEGER NOT NULL
     );`,
  );
}

/**
 * Make the snapshot rows agree with the files. A page that was closed in the middle of taking or
 * deleting a snapshot can leave a file without a row, or a row without a file.
 */
function reconcile(
  sqlite: Sqlite,
  pool: FilePool,
  journalOf: (name: string) => string | null,
): void {
  const files = new Set(
    pool.names().flatMap((file) => {
      const name = snapshotNameOfFile(file);
      return name === null ? [] : [name];
    }),
  );
  const rows = sqlite.prepare('SELECT name FROM snapshot').all() as { name: string }[];
  for (const { name } of rows) {
    if (!files.has(name)) sqlite.prepare('DELETE FROM snapshot WHERE name = ?').run(name);
  }
  const known = new Set(rows.map((row) => row.name));
  for (const name of files) {
    const journal = journalOf(name);
    if (known.has(name)) continue;
    if (journal === null) {
      pool.remove(snapshotFile(name));
      continue;
    }
    const size = pool.read(snapshotFile(name)).length;
    sqlite
      .prepare('INSERT INTO snapshot (name, journal, size) VALUES (?, ?, ?)')
      .run(name, journal, size);
  }
}

/**
 * Open the catalog, creating it on first use. `journalOf` tells which journal a snapshot file
 * belongs to from its name; a file that belongs to none is removed.
 */
export async function openCatalog(
  pool: FilePool,
  file: string,
  journalOf: (snapshotName: string) => string | null,
): Promise<Catalog> {
  await pool.reserve(1);
  const sqlite = pool.open(file);
  ensureTables(sqlite);
  reconcile(sqlite, pool, journalOf);

  return {
    activeJournal() {
      const row = sqlite.prepare('SELECT value FROM kv WHERE key = ?').get(ACTIVE_JOURNAL_KEY) as
        { value: string } | undefined;
      return row?.value ?? null;
    },
    setActiveJournal(id) {
      if (id === null) {
        sqlite.prepare('DELETE FROM kv WHERE key = ?').run(ACTIVE_JOURNAL_KEY);
        return;
      }
      sqlite
        .prepare(
          'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        )
        .run(ACTIVE_JOURNAL_KEY, id);
    },
    snapshots: (journal) =>
      sqlite
        .prepare('SELECT name, journal, size FROM snapshot WHERE journal = ?')
        .all(journal) as SnapshotRecord[],
    addSnapshot: (record) =>
      void sqlite
        .prepare('INSERT INTO snapshot (name, journal, size) VALUES (?, ?, ?)')
        .run(record.name, record.journal, record.size),
    removeSnapshot: (name) => void sqlite.prepare('DELETE FROM snapshot WHERE name = ?').run(name),
    close: () => void sqlite.close(),
  };
}
