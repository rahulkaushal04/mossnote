import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorBody } from '@shared/errors';
import type { Settings } from '@shared/schemas/settings';
import type { JournalList, Note, Page } from '@shared/types';
import { describeStartupError, openJournal } from './boot';
import { loadConfig } from './config';
import { listSnapshots } from './db/backup';
import { openDatabase } from './db/client';
import { NewerJournalError } from './db/migrate';
import { silentLogger } from './logger';
import { fakeClock, makeTempDir, MIGRATIONS_FOLDER, removeDir } from './testing/helpers';
import { makeJournalsApp } from './testing/journals';
import {
  MIGRATION_COUNT,
  OLDER_RECORDS,
  olderMigrations,
  writeOlderJournal,
} from './testing/older';

/**
 * Upgrades: an older journal opened by this build, a newer journal opened by an older build, and
 * the single-journal layout of earlier versions. Every test uses real files in a real folder.
 */
let dir: string;
beforeEach(() => {
  dir = makeTempDir('moss-upgrade-');
});
afterEach(() => {
  removeDir(dir);
});

const sha = (file: string) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rowCount = (sqlite: { prepare: (sql: string) => { get: () => unknown } }, table: string) =>
  (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('an older journal opened by this build', () => {
  // Every schema this app has ever shipped, from the first migration up to the one before now.
  const older = Array.from({ length: MIGRATION_COUNT - 1 }, (_, i) => i + 1);

  it.each(older)(
    'migrates forward from schema %i, after a pre-migration snapshot, without losing a record',
    async (schema) => {
      const config = loadConfig({ MOSS_DATA_DIR: dir });
      await writeOlderJournal(config.dbPath, { schema });

      const journal = await openJournal({
        config,
        clock: fakeClock(),
        logger: silentLogger,
        migrationsFolder: MIGRATIONS_FOLDER,
      });
      try {
        expect(journal.migration.applied).toBe(MIGRATION_COUNT - schema);
        expect(journal.migration.snapshotPath).not.toBeNull();

        // The snapshot is the journal exactly as it was, at the old schema.
        const [snapshot] = listSnapshots(config.backupsDir, config.journal).filter(
          (s) => s.reason === 'pre-migration',
        );
        expect(snapshot).toBeDefined();
        const saved = openDatabase(snapshot?.path ?? '');
        expect(rowCount(saved.sqlite, 'notes')).toBe(1);
        expect(rowCount(saved.sqlite, '__drizzle_migrations')).toBe(schema);
        saved.sqlite.close();

        const { sqlite } = journal.database;
        expect(rowCount(sqlite, '__drizzle_migrations')).toBe(MIGRATION_COUNT);
        expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
        expect(sqlite.pragma('foreign_key_check')).toEqual([]);
        expect((sqlite.prepare('SELECT body FROM notes').get() as { body: string }).body).toBe(
          OLDER_RECORDS.note,
        );
        expect(rowCount(sqlite, 'people')).toBe(1);
        expect(rowCount(sqlite, 'plantings')).toBe(1);
        // The search index knows records that were written before it existed.
        const indexed = sqlite
          .prepare("SELECT count(*) AS n FROM search_fts WHERE kind = 'note'")
          .get() as { n: number };
        expect(indexed.n).toBe(1);
      } finally {
        journal.close();
      }
    },
  );

  it('does nothing and takes no extra snapshot when the journal is already current', async () => {
    const config = loadConfig({ MOSS_DATA_DIR: dir });
    await writeOlderJournal(config.dbPath);
    const open = () =>
      openJournal({
        config,
        clock: fakeClock(),
        logger: silentLogger,
        migrationsFolder: MIGRATIONS_FOLDER,
      });
    const first = await open();
    expect(first.migration).toEqual({ applied: 0, snapshotPath: null });
    first.close();
    const names = fs.readdirSync(config.backupsDir);
    (await open()).close();
    expect(fs.readdirSync(config.backupsDir)).toEqual(names);
  });

  it('keeps every older journal in the folder usable through the app, after one start', async () => {
    const app = await makeJournalsApp({
      prepare: async (root) => {
        const data = path.join(root, 'data');
        fs.mkdirSync(data, { recursive: true });
        await writeOlderJournal(path.join(data, 'journal.db'), { schema: 1 });
        await writeOlderJournal(path.join(data, 'second.db'), { schema: 2, name: 'Second' });
      },
    });
    try {
      const notes = async () =>
        ((await (await app.call('GET', '/api/notes')).json()) as Page<Note>).items.map(
          (n) => n.body,
        );
      expect(await notes()).toEqual([OLDER_RECORDS.note]);
      // The second one is migrated when it is opened, with its own snapshot first.
      expect(listSnapshots(app.config.backupsDir, 'second')).toEqual([]);
      expect((await app.call('POST', '/api/journals/second/activate')).status).toBe(200);
      expect(await notes()).toEqual([OLDER_RECORDS.note]);
      expect(
        listSnapshots(app.config.backupsDir, 'second').some((s) => s.reason === 'pre-migration'),
      ).toBe(true);
    } finally {
      app.close();
    }
  });
});

describe('a newer journal opened by an older build', () => {
  /** The folder of migrations an older build shipped: one fewer than this build. */
  const oldBuild = () => olderMigrations(dir, MIGRATION_COUNT - 1);

  const makeNewerJournal = async () => {
    const config = loadConfig({ MOSS_DATA_DIR: path.join(dir, 'data') });
    const journal = await openJournal({
      config,
      clock: fakeClock(),
      logger: silentLogger,
      migrationsFolder: MIGRATIONS_FOLDER,
      init: { name: 'Made by the newer build', template: 'default' },
    });
    journal.database.sqlite
      .prepare("INSERT INTO notes (id, body, created_at, updated_at) VALUES ('a', 'kept', 1, 1)")
      .run();
    journal.database.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    journal.close();
    return config;
  };

  it('refuses politely and changes nothing: no migration, no snapshot, no lock left behind', async () => {
    const config = await makeNewerJournal();
    const bytes = sha(config.dbPath);
    const backups = fs.readdirSync(config.backupsDir);

    const error = await openJournal({
      config,
      clock: fakeClock(),
      logger: silentLogger,
      migrationsFolder: oldBuild(),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NewerJournalError);
    const lines = describeStartupError(error, config);
    expect(lines).toEqual([
      'This journal was made by a newer version of Mossnote. Update Mossnote to open it. Nothing was changed.',
    ]);
    expect(sha(config.dbPath)).toBe(bytes);
    expect(fs.readdirSync(config.backupsDir)).toEqual(backups);
    expect(fs.existsSync(config.lockPath)).toBe(false);

    // And the newer build still opens it, with everything in it.
    const again = await openJournal({
      config,
      clock: fakeClock(),
      logger: silentLogger,
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    expect(
      (again.database.sqlite.prepare('SELECT body FROM notes').get() as { body: string }).body,
    ).toBe('kept');
    again.close();
  });

  it('is shown as needing a newer app, is never opened by the journal list, and does not stop other journals', async () => {
    const config = await makeNewerJournal();
    const keptBytes = sha(config.dbPath);
    fs.copyFileSync(config.dbPath, path.join(config.dataDir, 'from-the-future.db'));
    fs.rmSync(config.dbPath);
    const app = await makeJournalsApp({
      dir,
      migrationsFolder: oldBuild(),
      prepare: async () => {
        await writeOlderJournal(path.join(config.dataDir, 'ok.db'), { schema: 1, name: 'Fine' });
      },
    });
    try {
      // Started on the one it can open.
      expect(app.manager.activeId).toBe('ok');
      const list = (await (await app.call('GET', '/api/journals')).json()) as JournalList;
      expect(list.items.map((j) => [j.id, j.status])).toEqual([
        ['ok', 'ok'],
        ['from-the-future', 'needs_newer_app'],
      ]);

      const res = await app.call('POST', '/api/journals/from-the-future/activate');
      expect(res.status).toBe(409);
      const body = (await res.json()) as ApiErrorBody;
      expect(body.error.message).toMatch(/newer version of Mossnote/);
      expect(body.error.details).toEqual({ reason: 'needs_newer_app' });
      expect(app.manager.activeId).toBe('ok');
      expect(sha(path.join(config.dataDir, 'from-the-future.db'))).toBe(keptBytes);

      // Renaming it would write to it, so that is refused too.
      const rename = await app.call('PATCH', '/api/journals/from-the-future', { name: 'x' });
      expect(rename.status).toBe(409);
      expect(sha(path.join(config.dataDir, 'from-the-future.db'))).toBe(keptBytes);
    } finally {
      app.close();
    }
  });

  it('stops the whole start with the message when it is the only journal', async () => {
    const config = await makeNewerJournal();
    const app = await makeJournalsApp({
      dir,
      migrationsFolder: oldBuild(),
      start: false,
    });
    try {
      await expect(app.manager.start()).rejects.toBeInstanceOf(NewerJournalError);
      expect(fs.existsSync(config.lockPath)).toBe(false);
    } finally {
      app.close();
    }
  });
});

describe('the single-journal layout of earlier versions', () => {
  const settingsOf = async (app: Awaited<ReturnType<typeof makeJournalsApp>>) =>
    (await (await app.call('GET', '/api/settings')).json()) as Settings;

  const legacyApp = (options: { env?: Record<string, string>; schema?: number } = {}) =>
    makeJournalsApp({
      ...(options.env ? { env: options.env } : {}),
      prepare: async (root) => {
        const data = path.join(root, 'data');
        fs.mkdirSync(data, { recursive: true });
        await writeOlderJournal(path.join(data, `${options.env?.MOSS_JOURNAL ?? 'journal'}.db`), {
          ...(options.schema === undefined ? {} : { schema: options.schema }),
          name: options.env?.MOSS_JOURNAL ?? 'journal',
        });
      },
    });

  it('loads journal.db as a journal with no user action and no first-run question', async () => {
    const app = await legacyApp();
    try {
      expect(app.manager.activeId).toBe('journal');
      const list = (await (await app.call('GET', '/api/journals')).json()) as JournalList;
      expect(list.active).toBe('journal');
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({
        id: 'journal',
        name: 'My journal',
        template: 'stardew',
        status: 'ok',
        counts: { notes: 1, people: 1, plantings: 1 },
      });
      const notes = (await (await app.call('GET', '/api/notes')).json()) as Page<Note>;
      expect(notes.items.map((n) => n.body)).toEqual([OLDER_RECORDS.note]);
    } finally {
      app.close();
    }
  });

  it('detects the template from the existing settings: a seasons calendar and no layout is Stardew Valley', async () => {
    const app = await legacyApp();
    try {
      const settings = await settingsOf(app);
      expect(settings.layout).toMatchObject({ template: 'stardew', order: [], hidden: [] });
      expect(settings.calendar.seasons.map((s) => s.name)).toEqual([
        'Spring',
        'Summer',
        'Fall',
        'Winter',
      ]);
      // Its Farm section and the entry in it still work.
      const farm = (await (await app.call('GET', '/api/plantings')).json()) as Page<{
        label: string;
      }>;
      expect(farm.items.map((p) => p.label)).toEqual([OLDER_RECORDS.planting]);
      // Detecting is reading: nothing was written into the settings to do it.
      const peek = new BetterSqlite3(path.join(app.config.dataDir, 'journal.db'), {
        readonly: true,
      });
      const keys = peek.prepare('SELECT key FROM settings ORDER BY key').all() as { key: string }[];
      peek.close();
      expect(keys.map((k) => k.key)).toEqual(['calendar', 'meta']);
    } finally {
      app.close();
    }
  });

  it('keeps a stored layout as it was, with its renamed sections', async () => {
    const app = await makeJournalsApp({
      prepare: async (root) => {
        const data = path.join(root, 'data');
        fs.mkdirSync(data, { recursive: true });
        await writeOlderJournal(path.join(data, 'journal.db'), {
          extraSettings: {
            layout: {
              template: 'stardew',
              order: ['maps'],
              hidden: ['farm'],
              labels: { people: 'Neighbours' },
              quickActions: false,
            },
          },
        });
      },
    });
    try {
      expect((await settingsOf(app)).layout).toEqual({
        template: 'stardew',
        order: ['maps'],
        hidden: ['farm'],
        labels: { people: 'Neighbours' },
        quickActions: false,
      });
    } finally {
      app.close();
    }
  });

  it('loads a journal that MOSS_JOURNAL named, beside any others', async () => {
    const app = await legacyApp({ env: { MOSS_JOURNAL: 'second-playthrough' } });
    try {
      expect(app.manager.activeId).toBe('second-playthrough');
      expect((await settingsOf(app)).layout.template).toBe('stardew');
      const list = (await (await app.call('GET', '/api/journals')).json()) as JournalList;
      expect(list.items.map((j) => j.name)).toEqual(['second-playthrough']);
    } finally {
      app.close();
    }
  });

  it('upgrades the oldest schema and the layout together, and then lets a second journal sit beside it', async () => {
    const app = await legacyApp({ schema: 1 });
    try {
      expect(listSnapshots(app.config.backupsDir, 'journal').map((s) => s.reason)).toContain(
        'pre-migration',
      );
      expect((await settingsOf(app)).layout.template).toBe('stardew');
      const made = await app.call('POST', '/api/journals', {
        name: 'Another game',
        template: 'default',
      });
      expect(made.status).toBe(201);
      expect(
        fs
          .readdirSync(app.config.dataDir)
          .filter((f) => f.endsWith('.db'))
          .sort(),
      ).toEqual(['another-game.db', 'journal.db']);
      // Back on the old one, nothing changed.
      expect((await app.call('POST', '/api/journals/journal/activate')).status).toBe(200);
      const notes = (await (await app.call('GET', '/api/notes')).json()) as Page<Note>;
      expect(notes.items).toHaveLength(1);
    } finally {
      app.close();
    }
  });
});

describe('where data lives', () => {
  it('writes only inside the data folder, whatever is installed or upgraded around it', async () => {
    const app = await makeJournalsApp();
    try {
      await app.call('POST', '/api/journals', { name: 'Anywhere', template: 'default' });
      await app.call('POST', '/api/data/backup');
      expect(fs.readdirSync(app.dir)).toEqual(['data']);
      expect(app.config.dataDir.startsWith(app.dir)).toBe(true);
    } finally {
      app.close();
    }
  });
});
