import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR, SETTING_KEYS } from '@shared/constants';
import { loadConfig } from './config';
import { openJournal, type Journal } from './boot';
import { createApp } from './app';
import { silentLogger } from './logger';
import {
  fakeClock,
  makeTempDir,
  MIGRATIONS_FOLDER,
  removeDir,
  USER_TABLES,
} from './testing/helpers';

/**
 * Spoiler guard: a fresh journal, created by the real startup
 * sequence, contains no user records, and its only settings are the calendar and journal metadata.
 */
let dir: string;
let journal: Journal;
let config: ReturnType<typeof loadConfig>;
beforeEach(async () => {
  dir = makeTempDir();
  config = loadConfig({ MOSS_DATA_DIR: dir });
  journal = await openJournal({
    config,
    clock: fakeClock(),
    logger: silentLogger,
    migrationsFolder: MIGRATIONS_FOLDER,
  });
});
afterEach(() => {
  journal.close();
  removeDir(dir);
});

const rows = (table: string) =>
  (journal.database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('fresh database', () => {
  it.each(USER_TABLES)('has zero rows in %s', (table) => {
    expect(rows(table)).toBe(0);
  });

  it('covers notes, people, plantings, tags, links and search_fts explicitly', () => {
    for (const table of ['notes', 'people', 'plantings', 'tags', 'links', 'search_fts']) {
      expect(USER_TABLES).toContain(table);
    }
  });

  it('holds only the calendar and meta settings, and only allowed keys', () => {
    const keys = (
      journal.database.sqlite.prepare('SELECT key FROM settings ORDER BY key').all() as {
        key: string;
      }[]
    ).map((r) => r.key);
    expect(keys).toEqual(['calendar', 'meta']);
    for (const key of keys) expect(SETTING_KEYS).toContain(key);
  });

  it('has exactly the default calendar and no other pre-filled text', () => {
    const row = journal.database.sqlite
      .prepare("SELECT value FROM settings WHERE key = 'calendar'")
      .get() as { value: string };
    expect(JSON.parse(row.value)).toEqual(DEFAULT_CALENDAR);
    const meta = journal.database.sqlite
      .prepare("SELECT value FROM settings WHERE key = 'meta'")
      .get() as { value: string };
    expect(Object.keys(JSON.parse(meta.value) as object).sort()).toEqual([
      'createdAt',
      'journalName',
    ]);
  });

  it('creates no other tables with rows, including the migration bookkeeping', () => {
    const tables = (
      journal.database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    const allowedWithRows = new Set(['settings', '__drizzle_migrations']);
    for (const table of tables) {
      if (table.startsWith('search_fts_') || table === 'search_vocab') continue;
      if (allowedWithRows.has(table)) continue;
      expect(rows(table), table).toBe(0);
    }
  });

  it('serves empty data through the API', async () => {
    const app = createApp({
      db: journal.database.db,
      sqlite: journal.database.sqlite,
      clock: fakeClock(),
      config: { ...config, port: 4317, version: 'test' },
    });
    const res = await app.request('/api/settings', { headers: { host: '127.0.0.1:4317' } });
    const settings = (await res.json()) as { currentGameDate: unknown; calendar: unknown };
    expect(settings.currentGameDate).toBeNull();
    expect(settings.calendar).toEqual(DEFAULT_CALENDAR);
    // List endpoints join this check as they are added (notes, people, plantings, tags,
    // trash, search): every one must return an empty list on a fresh journal.
  });

  it('writes the database inside the data folder only', () => {
    expect(journal.database.sqlite.name).toBe(path.join(dir, 'journal.db'));
  });
});
