import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COUNTER_CALENDAR, DEFAULT_CALENDAR } from '@shared/constants';
import type { ApiErrorBody } from '@shared/errors';
import type { Settings } from '@shared/schemas/settings';
import type { BackupInfo, JournalInfo, JournalList, StorageLocation } from '@shared/types';
import { openDatabase } from '../db/client';
import { makeJournalsApp, type JournalsApp } from '../testing/journals';

let t: JournalsApp;
beforeEach(async () => {
  t = await makeJournalsApp();
});
afterEach(() => {
  t.close();
});

const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};
const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error;
const make = async (name: string, template: string) =>
  json<JournalInfo>(await t.call('POST', '/api/journals', { name, template }), 201);
const list = async () => json<JournalList>(await t.call('GET', '/api/journals'));
const settings = async () => json<Settings>(await t.call('GET', '/api/settings'));
const note = (body: string) => t.call('POST', '/api/notes', { body });
const noteBodies = async () =>
  (await json<{ items: { body: string }[] }>(await t.call('GET', '/api/notes'))).items.map(
    (n) => n.body,
  );

describe('a first run', () => {
  it('has no journal, says so, and refuses data requests until one is made', async () => {
    expect(await list()).toEqual({ active: null, items: [] });
    const health = await json<{ journal: string | null; schemaVersion: number }>(
      await t.call('GET', '/api/health'),
    );
    expect(health).toMatchObject({ journal: null, schemaVersion: 0 });
    const res = await t.call('GET', '/api/notes');
    expect(res.status).toBe(409);
    expect((await errorOf(res)).details).toEqual({ reason: 'no_journal' });
    expect(fs.readdirSync(t.config.dataDir).filter((f) => f.endsWith('.db'))).toEqual([]);
  });

  it('makes the first journal from the chosen template and opens it', async () => {
    const made = await make('My journal', 'default');
    expect(made).toMatchObject({
      id: 'my-journal',
      name: 'My journal',
      template: 'default',
      active: true,
      status: 'ok',
    });
    expect((await settings()).calendar).toEqual(COUNTER_CALENDAR);
    expect(await noteBodies()).toEqual([]);
    expect((await list()).active).toBe('my-journal');
  });

  it('starts a journal named by MOSS_JOURNAL without asking, from the Default template', async () => {
    const named = await makeJournalsApp({ env: { MOSS_JOURNAL: 'second' } });
    try {
      const res = await named.call('GET', '/api/settings');
      expect(((await res.json()) as Settings).layout.template).toBe('default');
      expect(named.manager.activeId).toBe('second');
    } finally {
      named.close();
    }
  });
});

describe('templates per journal', () => {
  it('keeps two Default journals and a Stardew Valley one side by side, each with its own data', async () => {
    await make('Game one', 'default');
    await note('first game');
    await make('Game two', 'default');
    await note('second game');
    await make('Farm game', 'stardew');
    await note('third game');

    const all = await list();
    expect(all.items.map((j) => [j.name, j.template, j.counts?.notes])).toEqual([
      ['Farm game', 'stardew', 1],
      ['Game one', 'default', 1],
      ['Game two', 'default', 1],
    ]);
    expect(all.active).toBe('farm-game');
    expect(fs.readdirSync(t.config.dataDir).filter((f) => f.endsWith('.db'))).toEqual([
      'farm-game.db',
      'game-one.db',
      'game-two.db',
    ]);

    await json(await t.call('POST', '/api/journals/game-one/activate'));
    expect(await noteBodies()).toEqual(['first game']);
    expect((await settings()).calendar).toEqual(COUNTER_CALENDAR);
    await json(await t.call('POST', '/api/journals/farm-game/activate'));
    expect(await noteBodies()).toEqual(['third game']);
    expect((await settings()).calendar).toEqual(DEFAULT_CALENDAR);
  });

  it('gives a journal an id that no other journal or snapshot of a removed one uses', async () => {
    expect((await make('My journal', 'default')).id).toBe('my-journal');
    expect((await make('My journal', 'default')).id).toBe('my-journal-2');
    const res = await t.call('POST', '/api/journals', { name: '   ', template: 'default' });
    expect(res.status).toBe(400);
    const odd = await t.call('POST', '/api/journals', { name: 'x', template: 'no-such-game' });
    expect(odd.status).toBe(400);
  });

  it('skips Farm routes, search and export for a Default journal, and keeps them for Stardew', async () => {
    await make('Plain', 'default');
    for (const [method, route] of [
      ['GET', '/api/plantings'],
      ['POST', '/api/plantings'],
      ['GET', '/api/plantings/01ARZ3NDEKTSV4RRFFQ69G5FAV'],
    ] as const) {
      const res = await t.call(method, route, method === 'POST' ? { label: 'x' } : undefined);
      expect(res.status, route).toBe(404);
    }
    await note('Example plain note');
    const search = await json<{ groups: { plantings: unknown[] } }>(
      await t.call('GET', '/api/search?q=example'),
    );
    expect(search.groups.plantings).toEqual([]);
    const md = await (await t.call('GET', '/api/data/export.md')).text();
    expect(md).not.toMatch(/farm/i);
    expect(md).toMatch(/1 notes · 0 people\n/);

    await make('Fields', 'stardew');
    expect((await t.call('POST', '/api/plantings', { label: 'Example entry' })).status).toBe(201);
    expect((await t.call('GET', '/api/plantings')).status).toBe(200);
    expect(await (await t.call('GET', '/api/data/export.md')).text()).toMatch(/1 farm entries/);
  });
});

describe('switching and the window that did not', () => {
  it('refuses a request from a window that is still showing another journal', async () => {
    await make('One', 'default');
    await make('Two', 'default');
    const stale = await t.call(
      'POST',
      '/api/notes',
      { body: 'would land in the wrong place' },
      {
        'x-moss-journal': 'one',
      },
    );
    expect(stale.status).toBe(409);
    expect((await errorOf(stale)).details).toEqual({ reason: 'journal_changed' });
    const fresh = await t.call('GET', '/api/notes', undefined, { 'x-moss-journal': 'two' });
    expect(fresh.status).toBe(200);
    expect(await noteBodies()).toEqual([]);
  });

  it('opens the journal used last when the app starts again', async () => {
    await make('One', 'default');
    await make('Two', 'stardew');
    await json(await t.call('POST', '/api/journals/one/activate'));
    t.stop();
    const again = await makeJournalsApp({ dir: t.dir });
    try {
      expect(again.manager.activeId).toBe('one');
    } finally {
      again.stop();
    }
  });

  it('answers 404 for a journal that does not exist and leaves the current one open', async () => {
    await make('One', 'default');
    const res = await t.call('POST', '/api/journals/missing/activate');
    expect(res.status).toBe(404);
    expect((await list()).active).toBe('one');
  });
});

describe('rename', () => {
  it('renames the open journal and one that is not open, keeping the file names', async () => {
    await make('Alpha', 'default');
    await make('Beta', 'default');
    const open = await json<JournalInfo>(
      await t.call('PATCH', '/api/journals/beta', { name: 'Beta, renamed' }),
    );
    expect(open).toMatchObject({ id: 'beta', name: 'Beta, renamed', active: true });
    const closed = await json<JournalInfo>(
      await t.call('PATCH', '/api/journals/alpha', { name: 'Alpha, renamed' }),
    );
    expect(closed).toMatchObject({ id: 'alpha', name: 'Alpha, renamed', active: false });
    expect((await list()).items.map((j) => j.name)).toEqual(['Alpha, renamed', 'Beta, renamed']);
    expect(fs.existsSync(path.join(t.config.dataDir, 'alpha.lock'))).toBe(false);
    expect((await t.call('PATCH', '/api/journals/beta', { name: '' })).status).toBe(400);
  });
});

describe('delete', () => {
  it('needs the name typed back and changes nothing otherwise', async () => {
    await make('Doomed', 'default');
    await note('keep me');
    const res = await t.call('DELETE', '/api/journals/doomed', {
      confirmName: 'doom',
      finalSnapshot: true,
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).message).toBe("Type the journal's name exactly to delete it.");
    expect(await noteBodies()).toEqual(['keep me']);
    expect(fs.existsSync(path.join(t.config.dataDir, 'doomed.db'))).toBe(true);
  });

  it('removes the files, keeps a final snapshot, and opens another journal', async () => {
    await make('Keeper', 'default');
    await note('stay');
    await make('Doomed', 'default');
    await note('go');
    const result = await json<{ active: string | null; snapshot: string | null }>(
      await t.call('DELETE', '/api/journals/doomed', {
        confirmName: 'Doomed',
        finalSnapshot: true,
      }),
    );
    expect(result.active).toBe('keeper');
    expect(result.snapshot).toMatch(/^doomed-.*-manual\.db$/);
    expect(fs.existsSync(path.join(t.config.dataDir, 'doomed.db'))).toBe(false);
    expect(fs.existsSync(path.join(t.config.dataDir, 'doomed.lock'))).toBe(false);
    expect(fs.existsSync(path.join(t.config.backupsDir, result.snapshot ?? 'x'))).toBe(true);
    expect(await noteBodies()).toEqual(['stay']);

    // The name is free again, but not the id: that would adopt the old snapshot.
    expect((await make('Doomed', 'default')).id).toBe('doomed-2');
  });

  it('can delete a journal that is not open, with or without a last copy', async () => {
    await make('Far', 'stardew');
    await make('Near', 'default');
    const withCopy = await json<{ snapshot: string | null }>(
      await t.call('DELETE', '/api/journals/far', { confirmName: 'Far', finalSnapshot: true }),
    );
    expect(withCopy.snapshot).not.toBeNull();
    expect((await list()).items.map((j) => j.id)).toEqual(['near']);
    await make('Far', 'default');
    const without = await json<{ snapshot: string | null }>(
      await t.call('DELETE', '/api/journals/far-2', { confirmName: 'Far', finalSnapshot: false }),
    );
    expect(without.snapshot).toBeNull();
  });

  it('leaves no journal open after the last one goes, which is a first run again', async () => {
    await make('Only', 'default');
    const result = await json<{ active: string | null }>(
      await t.call('DELETE', '/api/journals/only', { confirmName: 'Only', finalSnapshot: false }),
    );
    expect(result.active).toBeNull();
    expect((await t.call('GET', '/api/notes')).status).toBe(409);
    expect(await list()).toEqual({ active: null, items: [] });
  });
});

describe('snapshots of the open journal', () => {
  const backups = async () =>
    (await json<{ items: BackupInfo[] }>(await t.call('GET', '/api/data/backups'))).items;

  it('restores an earlier snapshot, saving the journal as it is now first', async () => {
    await make('Restorable', 'default');
    await note('before');
    const snapshot = await json<BackupInfo>(await t.call('POST', '/api/data/backup'));
    t.clock.advance(120_000);
    await note('after');
    expect(await noteBodies()).toHaveLength(2);

    const result = await json<{ restored: BackupInfo; safety: BackupInfo }>(
      await t.call('POST', `/api/data/backups/${snapshot.name}/restore`),
    );
    expect(result.restored.name).toBe(snapshot.name);
    expect(result.safety.reason).toBe('pre-restore');
    expect(await noteBodies()).toEqual(['before']);
    expect((await backups()).map((b) => b.reason)).toContain('pre-restore');

    // And the journal as it was just before the restore can be put back the same way.
    await json(await t.call('POST', `/api/data/backups/${result.safety.name}/restore`));
    expect((await noteBodies()).sort()).toEqual(['after', 'before']);
    expect(fs.existsSync(path.join(t.config.dataDir, 'restorable.lock'))).toBe(true);
  });

  it('refuses a snapshot that is not there or is damaged, and changes nothing', async () => {
    await make('Careful', 'default');
    await note('safe');
    expect((await t.call('POST', '/api/data/backups/nope.db/restore')).status).toBe(404);
    const snapshot = await json<BackupInfo>(await t.call('POST', '/api/data/backup'));
    fs.writeFileSync(path.join(t.config.backupsDir, snapshot.name), 'this is not a database');
    const res = await t.call('POST', `/api/data/backups/${snapshot.name}/restore`);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).message).toMatch(/damaged/);
    expect(await noteBodies()).toEqual(['safe']);
  });

  it('deletes one snapshot and says so plainly when it is not there', async () => {
    await make('Tidy', 'default');
    const first = await json<BackupInfo>(await t.call('POST', '/api/data/backup'));
    t.clock.advance(120_000);
    await json<BackupInfo>(await t.call('POST', '/api/data/backup'));
    expect((await t.call('DELETE', `/api/data/backups/${first.name}`)).status).toBe(204);
    expect((await backups()).map((b) => b.name)).not.toContain(first.name);
    expect((await t.call('DELETE', `/api/data/backups/${first.name}`)).status).toBe(404);
    expect((await t.call('DELETE', '/api/data/backups/..%2Fjournal.db')).status).toBe(404);
  });

  it('keeps snapshots of one journal out of another journal’s list', async () => {
    await make('One', 'default');
    await t.call('POST', '/api/data/backup');
    await make('Two', 'default');
    const own = await backups();
    expect(own.every((b) => b.name.startsWith('two-'))).toBe(true);
  });
});

describe('export of any journal', () => {
  it('exports a journal that is not open, as JSON and Markdown, named after it', async () => {
    await make('Far away', 'default');
    await note('Example far note');
    await make('Near', 'stardew');
    await note('Example near note');

    const json = await t.call('GET', '/api/journals/far-away/export.json');
    expect(json.status).toBe(200);
    expect(json.headers.get('content-disposition')).toMatch(
      /^attachment; filename="mossnote-far-away-\d{4}-\d{2}-\d{2}-\d{4}\.json"$/,
    );
    const file = (await json.json()) as { journalName: string; notes: { body: string }[] };
    expect(file.journalName).toBe('Far away');
    expect(file.notes.map((n) => n.body)).toEqual(['Example far note']);

    const md = await (await t.call('GET', '/api/journals/far-away/export.md')).text();
    expect(md).toContain('Example far note');
    expect(md).not.toContain('Example near note');
    // The open journal still works, and still holds only its own note.
    expect(await noteBodies()).toEqual(['Example near note']);
    expect(fs.existsSync(path.join(t.config.dataDir, 'far-away.lock'))).toBe(false);
    expect((await t.call('GET', '/api/journals/missing/export.json')).status).toBe(404);
  });
});

describe('data location', () => {
  it('reports the folder, the journal, its size and snapshots, and opens the folder on request', async () => {
    await make('Located', 'default');
    await t.call('POST', '/api/data/backup');
    const info = await json<{
      location: StorageLocation;
      journal: { id: string; name: string };
      backupCount: number;
      backupBytes: number;
    }>(await t.call('GET', '/api/data/info'));
    expect(info).toMatchObject({
      location: {
        kind: 'folder',
        dataDir: t.config.dataDir,
        backupsDir: t.config.backupsDir,
        databasePath: path.join(t.config.dataDir, 'located.db'),
      },
      journal: { id: 'located', name: 'Located' },
    });
    expect(info.backupCount).toBeGreaterThanOrEqual(1);
    expect(info.backupBytes).toBeGreaterThan(0);
    expect((await t.call('POST', '/api/data/open-folder')).status).toBe(204);
    expect(t.opened).toEqual([t.config.dataDir]);
  });
});

describe('a journal file that cannot be opened', () => {
  it('is listed as unreadable and refuses to open without touching the current journal', async () => {
    await make('Fine', 'default');
    fs.writeFileSync(path.join(t.config.dataDir, 'broken.db'), 'not a database');
    const items = (await list()).items;
    expect(items.find((j) => j.id === 'broken')?.status).toBe('unreadable');
    const res = await t.call('POST', '/api/journals/broken/activate');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await list()).active).toBe('fine');
  });

  it('is skipped at start for the next journal that opens', async () => {
    await make('Fine', 'default');
    t.stop();
    fs.writeFileSync(path.join(t.config.dataDir, 'aaa-broken.db'), 'not a database');
    fs.writeFileSync(path.join(t.config.dataDir, 'active-journal'), 'aaa-broken\n');
    const again = await makeJournalsApp({ dir: t.dir });
    try {
      expect(again.manager.activeId).toBe('fine');
    } finally {
      again.stop();
    }
  });
});

describe('lock files', () => {
  it('holds a lock only for the open journal', async () => {
    await make('One', 'default');
    await make('Two', 'default');
    const locks = fs.readdirSync(t.config.dataDir).filter((f) => f.endsWith('.lock'));
    expect(locks).toEqual(['two.lock']);
    openDatabase(path.join(t.config.dataDir, 'one.db')).sqlite.close();
  });
});
