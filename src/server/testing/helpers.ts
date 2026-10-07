import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, type Database } from '../db/client';
import { migrateDatabase } from '../db/migrate';
import type { Clock } from '../db/backup';

/** The committed migrations, resolved from this file's location (src/server/testing). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));

export function makeTempDir(prefix = 'moss-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export interface FakeClock extends Clock {
  set(value: number): void;
  advance(ms: number): void;
}

export function fakeClock(start = Date.UTC(2026, 9, 7, 12, 0, 0)): FakeClock {
  let current = start;
  return {
    now: () => current,
    set(value) {
      current = value;
    },
    advance(ms) {
      current += ms;
    },
  };
}

/** A migrated in-memory database using the real migrations. */
export async function migratedMemoryDatabase(): Promise<Database> {
  const database = openDatabase(':memory:');
  await migrateDatabase({
    database,
    migrationsFolder: MIGRATIONS_FOLDER,
    backupsDir: makeTempDir('moss-unused-'),
    journal: 'journal',
    clock: fakeClock(),
    autoKeep: 14,
  });
  return database;
}

/** Tables that must be empty in a fresh journal (spec section 1, spoiler-free contract). */
export const USER_TABLES = [
  'notes',
  'people',
  'plantings',
  'tags',
  'links',
  'note_tags',
  'person_tags',
  'planting_tags',
  'maps',
  'map_pins',
  'map_versions',
  'search_fts',
] as const;
