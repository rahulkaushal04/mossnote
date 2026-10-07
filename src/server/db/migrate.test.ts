import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listSnapshots } from './backup';
import { openDatabase, type Database } from './client';
import {
  migrateDatabase,
  MigrationFailedError,
  NewerJournalError,
  NEWER_JOURNAL_MESSAGE,
} from './migrate';
import {
  fakeClock,
  makeTempDir,
  MIGRATIONS_FOLDER,
  removeDir,
  USER_TABLES,
} from '../testing/helpers';

let dir: string;
let database: Database;
beforeEach(() => {
  dir = makeTempDir();
  database = openDatabase(path.join(dir, 'journal.db'));
});
afterEach(() => {
  database.sqlite.close();
  removeDir(dir);
});

const run = (folder = MIGRATIONS_FOLDER) =>
  migrateDatabase({
    database,
    migrationsFolder: folder,
    backupsDir: path.join(dir, 'backups'),
    journal: 'journal',
    clock: fakeClock(),
    autoKeep: 14,
  });

const tableNames = () =>
  (
    database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);

/** Copy the migrations to a temp folder, keeping only the first `count` journal entries. */
function truncatedMigrations(count: number): string {
  const folder = path.join(dir, `migrations-${count}`);
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = path.join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

describe('migrations, forward from empty', () => {
  it('creates every table, the full-text index and its vocabulary', async () => {
    const result = await run();
    expect(result.applied).toBe(4);
    expect(tableNames()).toEqual(
      expect.arrayContaining([
        '__drizzle_migrations',
        'links',
        'map_pins',
        'map_versions',
        'maps',
        'note_tags',
        'notes',
        'people',
        'person_tags',
        'planting_tags',
        'plantings',
        'search_fts',
        'search_vocab',
        'settings',
        'tags',
      ]),
    );
  });

  it('is idempotent: a second run applies nothing', async () => {
    await run();
    const again = await run();
    expect(again).toEqual({ applied: 0, snapshotPath: null });
  });

  it('inserts no rows anywhere (no seed data)', async () => {
    await run();
    for (const table of [...USER_TABLES, 'settings']) {
      const row = database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
        n: number;
      };
      expect(row.n, table).toBe(0);
    }
  });

  it('takes no pre-migration snapshot for a brand new database', async () => {
    const result = await run();
    expect(result.snapshotPath).toBeNull();
    expect(listSnapshots(path.join(dir, 'backups'), 'journal')).toEqual([]);
  });
});

describe('migrations, from a previous release', () => {
  it('takes a pre-migration snapshot first and keeps existing data', async () => {
    const older = truncatedMigrations(1);
    await run(older);
    database.sqlite
      .prepare(
        "INSERT INTO tags (id, name, name_key, pinned, created_at) VALUES ('t1', 'Idea', 'idea', 0, 1)",
      )
      .run();

    const result = await run();
    expect(result.applied).toBe(3);
    expect(result.snapshotPath).not.toBeNull();
    expect(fs.existsSync(result.snapshotPath ?? '')).toBe(true);
    expect(path.basename(result.snapshotPath ?? '')).toMatch(/-pre-migration\.db$/);

    // The snapshot holds the pre-migration state (no FTS table yet) and the data survived.
    const snapshot = openDatabase(result.snapshotPath ?? '');
    const names = (
      snapshot.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(names).not.toContain('search_fts');
    snapshot.sqlite.close();
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM tags').get()).toEqual({ n: 1 });
  });
});

describe('migrations, safety', () => {
  it('refuses a journal created by a newer version', async () => {
    await run();
    database.sqlite
      .prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('unknown-hash', 9999999999999)",
      )
      .run();
    await expect(run()).rejects.toThrow(NewerJournalError);
    await expect(run()).rejects.toThrow(NEWER_JOURNAL_MESSAGE);
  });

  it('rolls back a failing migration, leaves earlier state intact and keeps the snapshot', async () => {
    await run(truncatedMigrations(2));
    database.sqlite
      .prepare(
        "INSERT INTO tags (id, name, name_key, pinned, created_at) VALUES ('t1', 'Idea', 'idea', 0, 1)",
      )
      .run();

    const broken = path.join(dir, 'broken');
    fs.cpSync(MIGRATIONS_FOLDER, broken, { recursive: true });
    fs.writeFileSync(
      path.join(broken, '0002_bad.sql'),
      'CREATE TABLE `half_done` (id text);\n--> statement-breakpoint\nTHIS IS NOT SQL;\n',
    );
    const journalPath = path.join(broken, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
    };
    const last = journal.entries.at(-1);
    journal.entries.push({
      idx: 2,
      version: '6',
      when: (last?.when ?? 0) + 1000,
      tag: '0002_bad',
      breakpoints: true,
    });
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    const error = await run(broken).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationFailedError);
    expect((error as MigrationFailedError).snapshotPath).not.toBeNull();
    expect(tableNames()).not.toContain('half_done');
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM tags').get()).toEqual({ n: 1 });
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual(
      {
        n: 2,
      },
    );
  });
});
