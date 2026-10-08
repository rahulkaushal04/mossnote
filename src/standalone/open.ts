import { isCorruption } from '@server/db/corruption';
import { integrityCheck, snapshotWhenDue, type SnapshotStore } from '@server/db/snapshots';
import { migrateWith, type MigrateResult, type Migration } from '@server/db/migrations';
import { createDb } from '@server/db/orm';
import type { Clock, Database, Sqlite } from '@server/db/types';
import { createCtx } from '@server/services/ctx';
import { reindexAll } from '@server/services/search-index';
import { ensureSettings } from '@server/services/settings';
import { purgeOldTrash } from '@server/services/trash';
import type { AppConfig } from '@server/app';
import { journalFile } from './names';
import type { FilePool } from './pool/types';

/** The journal failed `PRAGMA integrity_check`; it was left as it is. */
export class DamagedJournalError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super('The journal failed its integrity check.');
    this.problems = problems;
  }
}

/** The problems `integrity_check` finds; a file that is not a database at all counts as damaged. */
function checkIntegrity(sqlite: Sqlite): string[] {
  try {
    return integrityCheck(sqlite);
  } catch (error) {
    if (!isCorruption(error)) throw error;
    return [error instanceof Error ? error.message : 'The file is not a database.'];
  }
}

export interface OpenedJournal {
  id: string;
  database: Database;
  migration: MigrateResult;
  /** Close the connection. Safe to call twice. */
  close(): void;
}

export interface OpenJournalOptions {
  pool: FilePool;
  id: string;
  clock: Clock;
  migrations: readonly Migration[];
  snapshots: SnapshotStore;
  config: AppConfig;
  /** Name and template for a journal that does not exist yet. Ignored for an existing one. */
  init?: { name: string; template: string };
}

/**
 * The startup sequence for a journal in browser storage, in the order the Node server follows:
 * open, check integrity, migrate (with a `pre-migration` snapshot for an existing journal),
 * create the default settings, purge old deleted records, and take the daily snapshot when due.
 * A journal made by a newer version is refused before anything is written.
 */
export async function openBrowserJournal(options: OpenJournalOptions): Promise<OpenedJournal> {
  const { pool, id, clock, migrations, snapshots, config } = options;
  const file = journalFile(id);

  if (!pool.has(file)) await pool.reserve(1);
  const sqlite = pool.open(file);
  try {
    sqlite.pragma('foreign_keys = ON');
    const problems = checkIntegrity(sqlite);
    if (problems.length > 0) throw new DamagedJournalError(problems);

    const database: Database = { sqlite, db: createDb(sqlite) };
    const migration = await migrateWith({
      database,
      migrations,
      snapshots,
      journal: id,
      clock,
      autoKeep: config.backupKeep,
    });
    // A journal from before the search index existed has records the index does not know yet.
    if (migration.applied > 0) reindexAll(createCtx({ ...database, clock, config }));

    ensureSettings(database, options.init?.name ?? id, clock, options.init?.template);
    purgeOldTrash({ sqlite, clock });
    await snapshotWhenDue(snapshots, {
      sqlite,
      journal: id,
      clock,
      autoKeep: config.backupKeep,
    });

    let closed = false;
    return {
      id,
      database,
      migration,
      close() {
        if (closed) return;
        closed = true;
        sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
