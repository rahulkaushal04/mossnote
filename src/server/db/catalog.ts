import fs from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { calendarSchema } from '@shared/schemas/calendar';
import { layoutSchema } from '@shared/schemas/layout';
import { metaSchema } from '@shared/schemas/settings';
import { templateForLegacyCalendar, DEFAULT_TEMPLATE_ID } from '@shared/templates';
import { LEGACY_JOURNAL_ID, journalIdOfFile } from '../journals/paths';

/**
 * Read-only looks at the journal files in the data folder. Nothing here writes, locks or
 * migrates: the journal list works without opening any journal for use.
 */

/** How a journal file compares with this build's schema. */
export type SchemaState = 'new' | 'current' | 'older' | 'newer';

export interface Inspection {
  schema: SchemaState;
  /** Set when the file could not be read as a journal at all. */
  unreadable: boolean;
  name: string;
  template: string;
  createdAt: number | null;
  counts: { notes: number; people: number; plantings: number; maps: number } | null;
}

export interface KnownMigrations {
  /** Hashes of every migration this build ships, oldest first. */
  hashes: string[];
}

const cache = new Map<string, KnownMigrations>();

export function knownMigrations(migrationsFolder: string): KnownMigrations {
  const hit = cache.get(migrationsFolder);
  if (hit) return hit;
  const loaded = { hashes: readMigrationFiles({ migrationsFolder }).map((m) => m.hash) };
  cache.set(migrationsFolder, loaded);
  return loaded;
}

function tableExists(sqlite: BetterSqlite3.Database, name: string): boolean {
  return (
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

function setting(sqlite: BetterSqlite3.Database, key: string): unknown {
  if (!tableExists(sqlite, 'settings')) return undefined;
  const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row ? (JSON.parse(row.value) as unknown) : undefined;
}

function count(sqlite: BetterSqlite3.Database, table: string): number {
  if (!tableExists(sqlite, table)) return 0;
  const sql = `SELECT count(*) AS n FROM ${table} WHERE deleted_at IS NULL`;
  return (sqlite.prepare(sql).get() as { n: number }).n;
}

/** Compare the migrations recorded in an open database with the ones this build knows. */
export function schemaStateOf(sqlite: BetterSqlite3.Database, known: KnownMigrations): SchemaState {
  if (!tableExists(sqlite, '__drizzle_migrations')) return 'new';
  const applied = (
    sqlite.prepare('SELECT hash FROM __drizzle_migrations').all() as { hash: string }[]
  ).map((row) => row.hash);
  if (applied.length === 0) return 'new';
  const knownSet = new Set(known.hashes);
  if (applied.some((hash) => !knownSet.has(hash))) return 'newer';
  return applied.length === known.hashes.length ? 'current' : 'older';
}

/** The schema state of a journal file, read without changing anything. 'new' if it has no file. */
export function peekSchema(dbPath: string, known: KnownMigrations): SchemaState {
  if (!fs.existsSync(dbPath)) return 'new';
  const sqlite = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  try {
    return schemaStateOf(sqlite, known);
  } finally {
    sqlite.close();
  }
}

/** Name, template and size facts of a journal file, for the journal list. */
export function inspectJournalFile(dbPath: string, id: string, known: KnownMigrations): Inspection {
  const fallback: Inspection = {
    schema: 'current',
    unreadable: true,
    name: id,
    template: DEFAULT_TEMPLATE_ID,
    createdAt: null,
    counts: null,
  };
  let sqlite: BetterSqlite3.Database;
  try {
    sqlite = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return fallback;
  }
  try {
    const schema = schemaStateOf(sqlite, known);
    // A newer schema may have moved things; do not guess at its contents.
    if (schema === 'newer') return { ...fallback, schema, unreadable: false };

    const meta = metaSchema.safeParse(setting(sqlite, 'meta'));
    const calendar = calendarSchema.safeParse(setting(sqlite, 'calendar'));
    const layout = layoutSchema.safeParse(setting(sqlite, 'layout'));
    const template = layout.success
      ? layout.data.template
      : calendar.success
        ? templateForLegacyCalendar(calendar.data)
        : DEFAULT_TEMPLATE_ID;
    return {
      schema,
      unreadable: false,
      name: displayName(meta.success ? meta.data.journalName : id, id),
      template,
      createdAt: meta.success ? meta.data.createdAt : null,
      counts: {
        notes: count(sqlite, 'notes'),
        people: count(sqlite, 'people'),
        plantings: count(sqlite, 'plantings'),
        maps: count(sqlite, 'maps'),
      },
    };
  } catch {
    return fallback;
  } finally {
    sqlite.close();
  }
}

/** The legacy single journal was named after its file; show that as something a person would write. */
export function displayName(stored: string, id: string): string {
  return id === LEGACY_JOURNAL_ID && stored === LEGACY_JOURNAL_ID ? 'My journal' : stored;
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
