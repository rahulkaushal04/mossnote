import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CALENDAR } from '@shared/constants';
import { openDatabase } from '../db/client';
import { migrateDatabase } from '../db/migrate';
import { fakeClock } from './helpers';
import { MIGRATIONS_FOLDER } from './helpers';

/** How many migrations this build ships. */
export const MIGRATION_COUNT = (
  JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: unknown[];
  }
).entries.length;

/**
 * A copy of the migrations folder that only knows the first `count` migrations: what an older
 * build of the app shipped.
 */
export function olderMigrations(parent: string, count: number): string {
  const folder = path.join(parent, `migrations-${count}`);
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = path.join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

/** Neutral filler that every schema version can hold. */
export const OLDER_RECORDS = {
  note: 'Example note written long ago',
  person: 'Example Person',
  planting: 'Example entry',
} as const;

/**
 * Write a journal file exactly as an older build would have left it: schema `count` migrations
 * deep, the settings that build created (a seasons calendar and metadata, no layout), and a few
 * records. The database is closed again, so a newer build can open it.
 */
export async function writeOlderJournal(
  dbPath: string,
  options: { schema?: number; name?: string; extraSettings?: Record<string, unknown> } = {},
): Promise<void> {
  const schema = options.schema ?? MIGRATION_COUNT;
  const database = openDatabase(dbPath);
  const { sqlite } = database;
  await migrateDatabase({
    database,
    migrationsFolder: olderMigrations(path.dirname(dbPath), schema),
    backupsDir: path.join(path.dirname(dbPath), 'unused-backups'),
    journal: 'unused',
    clock: fakeClock(),
    autoKeep: 1,
  });
  const setting = sqlite.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 1)');
  setting.run('calendar', JSON.stringify(DEFAULT_CALENDAR));
  setting.run('meta', JSON.stringify({ createdAt: 1, journalName: options.name ?? 'journal' }));
  for (const [key, value] of Object.entries(options.extraSettings ?? {})) {
    setting.run(key, JSON.stringify(value));
  }
  sqlite
    .prepare(
      'INSERT INTO notes (id, body, game_date, created_at, updated_at) VALUES (?, ?, ?, 1, 1)',
    )
    .run('01ARZ3NDEKTSV4RRFFQ69G5FAV', OLDER_RECORDS.note, 10_103);
  sqlite
    .prepare('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)')
    .run('01ARZ3NDEKTSV4RRFFQ69G5FAW', OLDER_RECORDS.person);
  sqlite
    .prepare('INSERT INTO plantings (id, label, created_at, updated_at) VALUES (?, ?, 1, 1)')
    .run('01ARZ3NDEKTSV4RRFFQ69G5FAX', OLDER_RECORDS.planting);
  sqlite.pragma('wal_checkpoint(TRUNCATE)');
  sqlite.close();
}
