import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Database } from './client';
import { createSnapshot, type Clock } from './backup';

export const NEWER_JOURNAL_MESSAGE = 'This journal was created by a newer version of Mossnote.';

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
  migrationsFolder: string;
  backupsDir: string;
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

function readApplied(database: Database): AppliedRow[] {
  const exists = database.sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!exists) return [];
  return database.sqlite
    .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
    .all() as AppliedRow[];
}

/**
 * Apply pending migrations (spec section 18).
 * - Refuses a database that contains a migration this build does not know.
 * - Takes a `pre-migration` snapshot first, but not for a brand new database (nothing to protect).
 * - Runs all pending migrations in one transaction; on failure nothing is applied.
 */
export async function migrateDatabase(options: MigrateOptions): Promise<MigrateResult> {
  const { database, migrationsFolder, backupsDir, journal, clock, autoKeep } = options;
  const known = readMigrationFiles({ migrationsFolder });
  const applied = readApplied(database);

  const knownHashes = new Set(known.map((m) => m.hash));
  if (applied.some((row) => !knownHashes.has(row.hash))) throw new NewerJournalError();

  const lastApplied = applied.reduce((max, row) => Math.max(max, Number(row.created_at)), -1);
  const pending = known.filter((m) => m.folderMillis > lastApplied);
  if (pending.length === 0) return { applied: 0, snapshotPath: null };

  let snapshotPath: string | null = null;
  if (applied.length > 0) {
    const snapshot = await createSnapshot({
      sqlite: database.sqlite,
      backupsDir,
      journal,
      reason: 'pre-migration',
      clock,
      autoKeep,
    });
    snapshotPath = snapshot.path;
  }

  try {
    migrate(database.db, { migrationsFolder });
  } catch (error) {
    throw new MigrationFailedError(error, snapshotPath);
  }
  return { applied: pending.length, snapshotPath };
}
