import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { SnapshotStore } from './snapshots';
import type { Clock, Database, Sqlite } from './types';

/**
 * Applying migrations: portable, so the Node server and the browser runtime upgrade a journal
 * the same way. Reading the migration files is the caller's job (`db/migrate.ts` reads them from
 * the `drizzle` folder; the browser build embeds them).
 */

/** One migration: its SQL statements, the time it was generated, and the hash of its file. */
export type Migration = MigrationMeta;

export const NEWER_JOURNAL_MESSAGE =
  'This journal was made by a newer version of Mossnote. Update Mossnote to open it. Nothing was changed.';

/** The database holds a migration this build does not know. */
export class NewerJournalError extends Error {
  constructor() {
    super(NEWER_JOURNAL_MESSAGE);
  }
}

/** A migration failed and was rolled back. `snapshotPath` is the pre-migration snapshot, if any. */
export class MigrationFailedError extends Error {
  readonly snapshotPath: string | null;
  constructor(cause: unknown, snapshotPath: string | null) {
    super(`Migration failed and was rolled back: ${(cause as Error).message}`, { cause });
    this.snapshotPath = snapshotPath;
  }
}

export interface MigrateOptions {
  database: Database;
  migrations: readonly Migration[];
  snapshots: SnapshotStore;
  journal: string;
  clock: Clock;
  autoKeep: number;
}

export interface MigrateResult {
  /** Number of migrations applied by this call. */
  applied: number;
  /** Path of the pre-migration snapshot, or null when none was needed. */
  snapshotPath: string | null;
}

interface AppliedRow {
  hash: string;
  created_at: number | string;
}

function readApplied(sqlite: Sqlite): AppliedRow[] {
  const exists = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!exists) return [];
  return sqlite
    .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
    .all() as AppliedRow[];
}

/**
 * Run the migrations newer than the last applied one, all in one transaction. Same table and
 * rules as Drizzle's own migrator, so a journal is the same whichever runtime migrated it.
 */
function runPending(sqlite: Sqlite, migrations: readonly Migration[]): void {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  const last = sqlite
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
    .get() as { created_at: number | string } | undefined;
  const insert = sqlite.prepare(
    'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
  );
  sqlite.exec('BEGIN');
  try {
    for (const migration of migrations) {
      if (last && Number(last.created_at) >= migration.folderMillis) continue;
      for (const statement of migration.sql) sqlite.exec(statement);
      insert.run(migration.hash, migration.folderMillis);
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Apply pending migrations.
 * - Refuses a database that contains a migration this build does not know.
 * - Takes a `pre-migration` snapshot first, but not for a brand new database (nothing to protect).
 * - Runs all pending migrations in one transaction; on failure nothing is applied.
 */
export async function migrateWith(options: MigrateOptions): Promise<MigrateResult> {
  const { database, migrations, snapshots, journal, clock, autoKeep } = options;
  const applied = readApplied(database.sqlite);

  const knownHashes = new Set(migrations.map((m) => m.hash));
  if (applied.some((row) => !knownHashes.has(row.hash))) throw new NewerJournalError();

  const lastApplied = applied.reduce((max, row) => Math.max(max, Number(row.created_at)), -1);
  const pending = migrations.filter((m) => m.folderMillis > lastApplied);
  if (pending.length === 0) return { applied: 0, snapshotPath: null };

  let snapshotPath: string | null = null;
  if (applied.length > 0) {
    const snapshot = await snapshots.create({
      sqlite: database.sqlite,
      journal,
      reason: 'pre-migration',
      clock,
      autoKeep,
    });
    snapshotPath = snapshot.path;
  }

  try {
    runPending(database.sqlite, migrations);
  } catch (error) {
    throw new MigrationFailedError(error, snapshotPath);
  }
  return { applied: pending.length, snapshotPath };
}
