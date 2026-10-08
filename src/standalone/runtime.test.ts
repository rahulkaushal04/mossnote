import { afterEach, describe, expect, it } from 'vitest';
import type {
  BackupInfo,
  DataInfo,
  JournalInfo,
  JournalList,
  Note,
  Page,
  SearchResponse,
} from '@shared/types';
import { journalFile } from './names';
import { makeTestRuntime, type TestRuntime } from './testing/runtime';

let t: TestRuntime;
afterEach(() => {
  t.runtime.close();
});

const startFresh = async (): Promise<void> => {
  t = await makeTestRuntime();
};

const createJournal = async (name: string, template = 'default') =>
  t.json<JournalInfo>(await t.call('POST', '/api/journals', { name, template }), 201);

const addNote = async (body: string) => {
  t.clock.advance(1000);
  return t.json<Note>(await t.call('POST', '/api/notes', { body }), 201);
};

const noteBodies = async () =>
  (await t.json<Page<Note>>(await t.call('GET', '/api/notes'))).items.map((n) => n.body).sort();

describe('a first run', () => {
  it('has no journal until one is made, and says so', async () => {
    await startFresh();

    const health = await t.json<{ journal: string | null }>(await t.call('GET', '/api/health'));
    const refused = await t.error(await t.call('GET', '/api/notes'), 409);

    expect(health.journal).toBeNull();
    expect(refused.details).toEqual({ reason: 'no_journal' });
  });

  it('makes a journal from a template and opens it', async () => {
    await startFresh();

    const made = await createJournal('Example journal', 'stardew');

    expect(made).toMatchObject({ id: 'example-journal', name: 'Example journal', active: true });
    const health = await t.json<{ journal: string }>(await t.call('GET', '/api/health'));
    expect(health.journal).toBe('example-journal');
    expect(await noteBodies()).toEqual([]);
  });

  it('starts empty: nothing is pre-filled', async () => {
    await startFresh();
    await createJournal('Example');

    const info = await t.json<DataInfo>(await t.call('GET', '/api/data/info'));

    expect(info.counts).toEqual({ notes: 0, people: 0, plantings: 0, tags: 0, maps: 0 });
  });
});

describe('records', () => {
  it('keeps notes, finds them by search, and counts them', async () => {
    await startFresh();
    await createJournal('Example');

    await addNote('Example lantern near the old bridge');
    await addNote('Another note about nothing');

    const found = await t.json<SearchResponse>(await t.call('GET', '/api/search?q=lantern'));
    expect(found.groups.notes).toHaveLength(1);
    expect(await noteBodies()).toHaveLength(2);
  });

  it('forgives a typo in a search', async () => {
    await startFresh();
    await createJournal('Example');
    await addNote('Example lantern near the old bridge');

    const found = await t.json<SearchResponse>(await t.call('GET', '/api/search?q=lanturn'));

    expect(found.groups.notes).toHaveLength(1);
  });

  it('keeps everything across a restart of the page', async () => {
    await startFresh();
    await createJournal('Example');
    await addNote('Written before the reload');

    t = await t.restart();

    expect((await t.json<{ journal: string }>(await t.call('GET', '/api/health'))).journal).toBe(
      'example',
    );
    expect(await noteBodies()).toEqual(['Written before the reload']);
  });
});

describe('several journals', () => {
  it('keeps each journal’s records apart and remembers which was open', async () => {
    await startFresh();
    await createJournal('First');
    await addNote('In the first');
    const second = await createJournal('Second');
    await addNote('In the second');

    expect(await noteBodies()).toEqual(['In the second']);
    await t.json(await t.call('POST', '/api/journals/first/activate'));
    expect(await noteBodies()).toEqual(['In the first']);

    t = await t.restart();

    expect(second.id).toBe('second');
    expect((await t.json<JournalList>(await t.call('GET', '/api/journals'))).active).toBe('first');
  });

  it('lists every journal with its counts', async () => {
    await startFresh();
    await createJournal('First');
    await addNote('One');
    await createJournal('Second');

    const list = await t.json<JournalList>(await t.call('GET', '/api/journals'));

    expect(list.items.map((j) => [j.id, j.counts?.notes, j.active])).toEqual([
      ['first', 1, false],
      ['second', 0, true],
    ]);
    expect(list.items.every((j) => j.status === 'ok' && j.bytes > 0)).toBe(true);
  });

  it('renames a journal, the open one and another', async () => {
    await startFresh();
    await createJournal('First');
    await createJournal('Second');

    await t.json(await t.call('PATCH', '/api/journals/second', { name: 'Renamed open' }));
    await t.json(await t.call('PATCH', '/api/journals/first', { name: 'Renamed closed' }));

    const names = (await t.json<JournalList>(await t.call('GET', '/api/journals'))).items.map(
      (j) => j.name,
    );
    expect(names).toEqual(['Renamed closed', 'Renamed open']);
  });

  it('asks for the name before deleting, keeps a last copy, and opens another journal', async () => {
    await startFresh();
    await createJournal('First');
    await addNote('Survivor');
    await createJournal('Doomed');

    const wrong = await t.call('DELETE', '/api/journals/doomed', {
      confirmName: 'nope',
      finalSnapshot: true,
    });
    expect(wrong.status).toBe(400);

    const result = await t.json<{ active: string | null; snapshot: string | null }>(
      await t.call('DELETE', '/api/journals/doomed', {
        confirmName: 'Doomed',
        finalSnapshot: true,
      }),
    );

    expect(result.active).toBe('first');
    expect(result.snapshot).toMatch(/^doomed-.*-manual\.db$/);
    expect(t.pool.has(journalFile('doomed'))).toBe(false);
    expect(await noteBodies()).toEqual(['Survivor']);
  });

  it('does not reuse the id of a deleted journal that still has snapshots', async () => {
    await startFresh();
    await createJournal('Same name');
    await t.json(
      await t.call('DELETE', '/api/journals/same-name', {
        confirmName: 'Same name',
        finalSnapshot: true,
      }),
    );

    const again = await createJournal('Same name');

    expect(again.id).toBe('same-name-2');
  });
});

describe('export, import and backups', () => {
  it('exports a journal and imports it into another, taking a snapshot first', async () => {
    await startFresh();
    await createJournal('Source');
    await addNote('Travels as a file');
    const exported = await t.json<unknown>(await t.call('GET', '/api/data/export.json'));
    await createJournal('Target');

    const dry = await t.json<{ errors: unknown[] }>(
      await t.call('POST', '/api/data/import?dryRun=1', exported),
    );
    const imported = await t.json<{ snapshot: string }>(
      await t.call('POST', '/api/data/import', exported),
    );

    expect(dry.errors).toEqual([]);
    expect(imported.snapshot).toMatch(/-pre-import\.db$/);
    expect(await noteBodies()).toEqual(['Travels as a file']);
  });

  it('exports any journal, not only the open one', async () => {
    await startFresh();
    await createJournal('First');
    await addNote('In the first');
    await createJournal('Second');

    const response = await t.call('GET', '/api/journals/first/export.json');
    const file = await t.json<{ notes: { body: string }[] }>(response);

    expect(file.notes.map((n) => n.body)).toEqual(['In the first']);
    expect(response.headers.get('content-disposition')).toContain('mossnote-first-');
  });

  it('describes browser storage in the data info', async () => {
    await startFresh();
    await createJournal('Example');

    const info = await t.json<DataInfo>(await t.call('GET', '/api/data/info'));

    expect(info.location).toEqual({ kind: 'browser' });
    expect(info.databaseBytes).toBeGreaterThan(0);
  });

  it('takes a snapshot, lists it, restores it, and deletes it', async () => {
    await startFresh();
    await createJournal('Example');
    await addNote('Before the snapshot');
    const made = await t.json<BackupInfo>(await t.call('POST', '/api/data/backup'));
    await addNote('After the snapshot');

    const restored = await t.json<{ restored: BackupInfo; safety: BackupInfo }>(
      await t.call('POST', `/api/data/backups/${made.name}/restore`),
    );

    expect(await noteBodies()).toEqual(['Before the snapshot']);
    expect(restored.safety.reason).toBe('pre-restore');
    const listed = await t.json<{ items: BackupInfo[] }>(await t.call('GET', '/api/data/backups'));
    expect(listed.items.map((b) => b.reason)).toContain('manual');
    expect((await t.call('DELETE', `/api/data/backups/${made.name}`)).status).toBe(204);
  });

  it('puts the journal back as it was when restoring is the last thing undone', async () => {
    await startFresh();
    await createJournal('Example');
    await addNote('One');
    const made = await t.json<BackupInfo>(await t.call('POST', '/api/data/backup'));
    await addNote('Two');
    const { safety } = await t.json<{ safety: BackupInfo }>(
      await t.call('POST', `/api/data/backups/${made.name}/restore`),
    );

    await t.json(await t.call('POST', `/api/data/backups/${safety.name}/restore`));

    expect(await noteBodies()).toEqual(['One', 'Two']);
  });

  it('refuses to restore a snapshot that does not exist', async () => {
    await startFresh();
    await createJournal('Example');

    const response = await t.call('POST', '/api/data/backups/missing.db/restore');

    expect(response.status).toBe(404);
  });
});

describe('journals it cannot open', () => {
  it('lists a damaged journal as unreadable and refuses to open it', async () => {
    await startFresh();
    await createJournal('Fine');
    await t.pool.write(
      journalFile('broken'),
      new TextEncoder().encode('not a database'.repeat(100)),
    );

    const list = await t.json<JournalList>(await t.call('GET', '/api/journals'));
    const refused = await t.call('POST', '/api/journals/broken/activate');

    expect(list.items.find((j) => j.id === 'broken')?.status).toBe('unreadable');
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(await noteBodies()).toEqual([]);
  });

  it('refuses a journal made by a newer version, without changing it', async () => {
    await startFresh();
    await createJournal('Fine');
    await createJournal('Future');
    const future = t.runtime.journals.open?.sqlite;
    future?.exec(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('from-a-newer-build', 9999999999999)",
    );
    await t.json(await t.call('POST', '/api/journals/fine/activate'));

    const refused = await t.error(await t.call('POST', '/api/journals/future/activate'), 409);

    expect(refused.details).toEqual({ reason: 'needs_newer_app' });
    expect((await t.json<{ journal: string }>(await t.call('GET', '/api/health'))).journal).toBe(
      'fine',
    );
  });
});

describe('what only the computer does', () => {
  it('has no phone access to manage', async () => {
    await startFresh();

    expect((await t.call('GET', '/api/phone')).status).toBe(404);
  });
});
