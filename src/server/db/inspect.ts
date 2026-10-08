import { calendarSchema } from '@shared/schemas/calendar';
import { layoutSchema } from '@shared/schemas/layout';
import { metaSchema } from '@shared/schemas/settings';
import { LEGACY_JOURNAL_ID } from '@shared/journalId';
import { templateForLegacyCalendar, DEFAULT_TEMPLATE_ID } from '@shared/templates';
import type { Migration } from './migrations';
import type { Sqlite } from './types';

/**
 * Looking at a journal through an open connection, without changing anything: how its schema
 * compares with this build's, and the facts the journal list shows. Portable; `catalog.ts` adds
 * the Node parts that find journal files and open them read-only.
 */

/** How a journal compares with this build's schema. */
export type SchemaState = 'new' | 'current' | 'older' | 'newer';

export interface Inspection {
  schema: SchemaState;
  /** Set when the journal could not be read at all. */
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

export const knownMigrationsOf = (migrations: readonly Migration[]): KnownMigrations => ({
  hashes: migrations.map((m) => m.hash),
});

function tableExists(sqlite: Sqlite, name: string): boolean {
  return (
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

function setting(sqlite: Sqlite, key: string): unknown {
  if (!tableExists(sqlite, 'settings')) return undefined;
  const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row ? (JSON.parse(row.value) as unknown) : undefined;
}

function count(sqlite: Sqlite, table: string): number {
  if (!tableExists(sqlite, table)) return 0;
  const sql = `SELECT count(*) AS n FROM ${table} WHERE deleted_at IS NULL`;
  return (sqlite.prepare(sql).get() as { n: number }).n;
}

/** Compare the migrations recorded in an open database with the ones this build knows. */
export function schemaStateOf(sqlite: Sqlite, known: KnownMigrations): SchemaState {
  if (!tableExists(sqlite, '__drizzle_migrations')) return 'new';
  const applied = (
    sqlite.prepare('SELECT hash FROM __drizzle_migrations').all() as { hash: string }[]
  ).map((row) => row.hash);
  if (applied.length === 0) return 'new';
  const knownSet = new Set(known.hashes);
  if (applied.some((hash) => !knownSet.has(hash))) return 'newer';
  return applied.length === known.hashes.length ? 'current' : 'older';
}

/** The legacy single journal was named after its file; show that as something a person would write. */
export function displayName(stored: string, id: string): string {
  return id === LEGACY_JOURNAL_ID && stored === LEGACY_JOURNAL_ID ? 'My journal' : stored;
}

/** What the journal list shows for a journal that cannot be read. */
export const unreadableInspection = (id: string): Inspection => ({
  schema: 'current',
  unreadable: true,
  name: id,
  template: DEFAULT_TEMPLATE_ID,
  createdAt: null,
  counts: null,
});

/** Name, template and size facts of an open journal, for the journal list. */
export function inspectJournal(sqlite: Sqlite, id: string, known: KnownMigrations): Inspection {
  const fallback = unreadableInspection(id);
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
  }
}
