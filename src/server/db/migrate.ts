import { readMigrationFiles } from 'drizzle-orm/migrator';
import { createFileSnapshotStore } from './backup';
import { migrateWith, type MigrateResult, type Migration } from './migrations';
import type { Clock, Database } from './types';

export {
  MigrationFailedError,
  NEWER_JOURNAL_MESSAGE,
  NewerJournalError,
  type MigrateResult,
} from './migrations';

/** The migrations in the `drizzle` folder, oldest first. */
export function loadMigrations(migrationsFolder: string): Migration[] {
  return readMigrationFiles({ migrationsFolder });
}

export interface MigrateOptions {
  database: Database;
  migrationsFolder: string;
  backupsDir: string;
  journal: string;
  clock: Clock;
  autoKeep: number;
}

/**
 * Apply pending migrations from the `drizzle` folder, with the `pre-migration` snapshot going to
 * the backups folder. See {@link migrateWith} for the rules.
 */
export function migrateDatabase(options: MigrateOptions): Promise<MigrateResult> {
  const { migrationsFolder, backupsDir, ...rest } = options;
  return migrateWith({
    ...rest,
    migrations: loadMigrations(migrationsFolder),
    snapshots: createFileSnapshotStore(backupsDir),
  });
}
