import fs from 'node:fs';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { journalIdOfFile } from '../journals/paths';
import { openDatabaseReadOnly } from './client';
import {
  inspectJournal,
  knownMigrationsOf,
  schemaStateOf,
  unreadableInspection,
  type Inspection,
  type KnownMigrations,
  type SchemaState,
} from './inspect';

/**
 * Read-only looks at the journal files in the data folder. Nothing here writes, locks or
 * migrates: the journal list works without opening any journal for use.
 */

export { displayName, schemaStateOf } from './inspect';
export type { Inspection, KnownMigrations, SchemaState } from './inspect';

const cache = new Map<string, KnownMigrations>();

export function knownMigrations(migrationsFolder: string): KnownMigrations {
  const hit = cache.get(migrationsFolder);
  if (hit) return hit;
  const loaded = knownMigrationsOf(readMigrationFiles({ migrationsFolder }));
  cache.set(migrationsFolder, loaded);
  return loaded;
}

/** The schema state of a journal file, read without changing anything. 'new' if it has no file. */
export function peekSchema(dbPath: string, known: KnownMigrations): SchemaState {
  if (!fs.existsSync(dbPath)) return 'new';
  const { sqlite } = openDatabaseReadOnly(dbPath);
  try {
    return schemaStateOf(sqlite, known);
  } finally {
    sqlite.close();
  }
}

/** Name, template and size facts of a journal file, for the journal list. */
export function inspectJournalFile(dbPath: string, id: string, known: KnownMigrations): Inspection {
  let database;
  try {
    database = openDatabaseReadOnly(dbPath);
  } catch {
    return unreadableInspection(id);
  }
  try {
    return inspectJournal(database.sqlite, id, known);
  } finally {
    database.sqlite.close();
  }
}

/** Ids of the journal files in the data folder, oldest name first. */
export function journalIds(dataDir: string): string[] {
  if (!fs.existsSync(dataDir)) return [];
  return fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => journalIdOfFile(entry.name))
    .filter((id): id is string => id !== null)
    .sort();
}
