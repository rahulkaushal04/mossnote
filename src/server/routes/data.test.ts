import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encode } from '@shared/gameDate';
import type { ExportFile } from '@shared/schemas/export';
import type { BackupInfo, DataInfo, ImportSummary, SearchResponse } from '@shared/types';
import { Api, newId } from '../testing/api';
import { makeTestApp, type TestApp } from '../testing/app';

let t: TestApp;
let api: Api;
beforeEach(async () => {
  t = await makeTestApp();
  api = new Api(t);
});
afterEach(() => {
  api.expectIndexConsistent();
  api.expectNoOrphans();
  t.close();
});

const k = (year: number, season: number, day: number) => encode({ year, season, day });

/** A journal that uses every feature, in a custom calendar. */
async function seedRichJournal(a: Api = api) {
  const calendar = {
    seasons: [
      { name: 'Thaw', days: 10 },
      { name: 'Bloom', days: 20 },
      { name: 'Late Frost', days: 5 },
    ],
  };
  await a.t.call('PATCH', '/api/settings', {
    calendar,
    currentGameDate: encode({ year: 2, season: 1, day: 7 }),
    prefs: { readingSize: 'large' },
  });
  const person = await a.person({
    name: 'Example Person',
    notes: 'Line one\nLine two',
    progress: 2,
    progressMax: 5,
    customFields: [{ label: 'Label', value: 'Value' }],
    tags: ['idea', 'Person-tag'],
  });
  const entry = await a.planting({
    label: 'Example entry',
    plantedOn: encode({ year: 1, season: 0, day: 3 }),
    harvestedOn: encode({ year: 1, season: 1, day: 4 }),
    plantedCount: 4,
    harvestedCount: 7,
    notes: 'Row notes',
    customFields: [{ label: 'Spot', value: 'north' }],
    tags: ['idea'],
  });
  const first = await a.note({
    title: 'A title',
    body: 'Body with **markdown** and <b>html</b>\r\nsecond line',
    gameDate: encode({ year: 1, season: 2, day: 5 }),
    isDiscovery: true,
    tags: ['idea', 'unused-later'],
  });
  await a.note({
    body: 'Question note',
    gameDate: encode({ year: 2, season: 0, day: 1 }),
    question: {
      state: 'solved',
      resolution: 'Example answer.',
      solvedGameDate: encode({ year: 2, season: 0, day: 2 }),
    },
    links: [
      { type: 'person', id: person.id },
      { type: 'planting', id: entry.id },
      { type: 'note', id: first.id },
    ],
  });
  await a.note({
    body: 'Undated and open',
    question: { state: 'open', resolution: 'draft answer' },
  });
  a.tick();
  const map = (await (await a.t.call('POST', '/api/maps', { name: 'Sketch' })).json()) as {
    id: string;
  };
  await a.t.call('PATCH', `/api/maps/${map.id}`, {
    scene: [
      {
        id: 's1',
        t: 'stroke',
        color: 'moss',
        w: 3,
        pts: [
          [0, 0],
          [4, 4],
        ],
      },
    ],
  });
  await a.t.call('POST', `/api/maps/${map.id}/pins`, {
    x: 2.5,
    y: 3,
    label: 'Pin',
    note: 'Pin note',
    color: 'rose',
    target: { type: 'person', id: person.id },
  });
  const tags = await a.tags();
  const unused = tags.find((x) => x.name === 'Person-tag');
  await a.t.call('PATCH', `/api/tags/${unused?.id}`, { pinned: true });
  await a.t.call('POST', '/api/tags', { name: 'never-used' });
  return { person, entry, first };
}

const exportJson = async (a: Api = api): Promise<ExportFile> =>
  JSON.parse(await (await a.t.call('GET', '/api/data/export.json')).text()) as ExportFile;
const withoutTime = (file: ExportFile) => ({ ...file, exportedAt: 'x' });
const importFile = (file: unknown, a: Api = api, dry = false) =>
  a.t.call('POST', `/api/data/import${dry ? '?dryRun=1' : ''}`, file);

describe('JSON export', () => {
  it('has the export shape: ids, tags by name, dates as year/season/day, sorted, deterministic', async () => {
    const { person } = await seedRichJournal();
    const file = await exportJson();
    expect(file).toMatchObject({ format: 'mossnote', formatVersion: 1, journalName: 'journal' });
    expect(file.app).toEqual({ name: 'mossnote', version: '0.1.0-test' });
    expect(file.settings).toEqual({
      calendar: {
        seasons: [
          { name: 'Thaw', days: 10 },
          { name: 'Bloom', days: 20 },
          { name: 'Late Frost', days: 5 },
        ],
      },
      currentGameDate: { year: 2, season: 1, day: 7 },
      prefs: { readingSize: 'large' },
    });
    expect(file.tags.map((x) => x.name).sort()).toEqual([
      'Person-tag',
      'idea',
      'never-used',
      'unused-later',
    ]);
    expect(file.tags.find((x) => x.name === 'Person-tag')?.pinned).toBe(true);
    expect(file.people[0]).toMatchObject({
      id: person.id,
      tags: ['idea', 'Person-tag'].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    });
    const dated = file.notes.find((n) => n.title === 'A title');
    expect(dated?.gameDate).toEqual({ year: 1, season: 2, seasonName: 'Late Frost', day: 5 });
    expect(dated?.body).toBe('Body with **markdown** and <b>html</b>\nsecond line');
    expect(file.plantings[0]?.plantedOn).toEqual({ year: 1, season: 0, day: 3 });
    const solved = file.notes.find((n) => n.question?.state === 'solved');
    expect(solved?.question).toMatchObject({
      resolution: 'Example answer.',
      solvedGameDate: { year: 2, season: 0, day: 2 },
    });
    expect(solved?.links).toHaveLength(3);
    const sortedByCreated = [...file.notes].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    expect(file.notes).toEqual(sortedByCreated);
    expect(JSON.stringify(withoutTime(await exportJson()))).toBe(JSON.stringify(withoutTime(file)));
  });

  it('is served as an attachment with a dated name, two-space indent, LF and a trailing newline', async () => {
    await api.note({ body: 'x' });
    const res = await t.call('GET', '/api/data/export.json');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="mossnote-\d{4}-\d{2}-\d{2}-\d{4}\.json"$/,
    );
    expect(res.headers.get('content-type')).toContain('application/json');
    const text = await res.text();
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(text.split('\n')[1]).toMatch(/^ {2}"format"/);
  });

  it('excludes soft-deleted records, and drops links to them', async () => {
    const person = await api.person({ name: 'Gone' });
    const kept = await api.note({ body: 'kept', links: [{ type: 'person', id: person.id }] });
    const deleted = await api.note({ body: 'deleted' });
    await t.call('DELETE', `/api/people/${person.id}`);
    await t.call('DELETE', `/api/notes/${deleted.id}`);
    const file = await exportJson();
    expect(file.notes.map((n) => n.id)).toEqual([kept.id]);
    expect(file.people).toEqual([]);
    expect(file.notes[0]?.links).toEqual([]);
  });

  it('a fresh journal exports an empty record set and the default calendar', async () => {
    const file = await exportJson();
    expect([file.notes, file.people, file.plantings, file.tags]).toEqual([[], [], [], []]);
    expect(file.settings.calendar.seasons).toHaveLength(4);
    expect(file.settings.currentGameDate).toBeNull();
  });
});

describe('round trip', () => {
  it('export, import into an empty journal, export again: identical apart from exportedAt', async () => {
    await seedRichJournal();
    const original = await exportJson();
    const other = await makeTestApp();
    const b = new Api(other);
    const res = await importFile(original, b);
    expect(res.status).toBe(200);
    const again = await exportJson(b);
    expect(withoutTime(again)).toEqual(withoutTime(original));
    b.expectIndexConsistent();
    b.expectNoOrphans();
    other.close();
  });

  it('keeps every game date and the calendar exactly', async () => {
    await seedRichJournal();
    const original = await exportJson();
    const other = await makeTestApp();
    const b = new Api(other);
    await importFile(original, b);
    const settings = await b.json<{ calendar: unknown; currentGameDate: number }>(
      await other.call('GET', '/api/settings'),
    );
    expect(settings.calendar).toEqual(original.settings.calendar);
    expect(settings.currentGameDate).toBe(encode({ year: 2, season: 1, day: 7 }));
    const notes = (await b.notes('?limit=100')).items;
    expect(notes.map((n) => n.gameDate).sort()).toEqual(
      original.notes.map((n) => (n.gameDate ? encode(n.gameDate) : null)).sort(),
    );
    other.close();
  });

  it('importing into a non-empty journal replaces it', async () => {
    await seedRichJournal();
    const original = await exportJson();
    await api.note({ body: 'extra that must disappear', tags: ['stray'] });
    await importFile(original);
    expect(withoutTime(await exportJson())).toEqual(withoutTime(original));
    expect((await api.tags()).map((x) => x.name)).not.toContain('stray');
  });

  it('rebuilds the search index and keeps restored links working', async () => {
    const { person } = await seedRichJournal();
    const original = await exportJson();
    const other = await makeTestApp();
    const b = new Api(other);
    await importFile(original, b);
    const found = await b.json<SearchResponse>(await other.call('GET', '/api/search?q=markdown'));
    expect(found.groups.notes).toHaveLength(1);
    const person2 = await b.json<{ items: { id: string }[] }>(
      await other.call('GET', `/api/people/${person.id}/notes`),
    );
    expect(person2.items).toHaveLength(1);
    other.close();
  });
});

describe('import validation', () => {
  const snapshotOf = () =>
    JSON.stringify(t.database.sqlite.prepare('SELECT count(*) AS n FROM notes').get());
  const valid = async () => {
    await seedRichJournal();
    return exportJson();
  };
  const errors = async (file: unknown) => {
    const before = snapshotOf();
    const summary = await api.json<ImportSummary>(await importFile(file, api, true));
    const res = await importFile(file);
    expect(res.status).toBe(400);
    expect(snapshotOf()).toBe(before);
    return summary.errors;
  };

  it('a valid file passes the dry run and writes nothing', async () => {
    const file = await valid();
    const before = JSON.stringify(withoutTime(await exportJson()));
    const summary = await api.json<ImportSummary>(await importFile(file, api, true));
    expect(summary).toEqual({
      counts: { notes: 3, people: 1, plantings: 1, tags: 4, maps: 1 },
      warnings: [],
      errors: [],
    });
    expect(JSON.stringify(withoutTime(await exportJson()))).toBe(before);
  });

  it('rejects files that are not exports, listing the problem by path', async () => {
    expect((await errors({ hello: 'world' }))[0]).toEqual({
      path: '(file)',
      message: "That file isn't a Mossnote export.",
    });
    expect((await errors([1, 2]))[0]?.path).toBe('(file)');
    expect((await errors({ format: 'other', formatVersion: 1 }))[0]?.path).toBe('(file)');
    expect((await errors({ format: 'mossnote', formatVersion: 'one' }))[0]?.path).toBe('(file)');
    expect((await errors({ format: 'mossnote', formatVersion: 0 }))[0]?.path).toBe('(file)');
  });

  it('refuses a newer format version before any change', async () => {
    const file = { ...(await valid()), formatVersion: 2 };
    const list = await errors(file);
    expect(list).toEqual([
      {
        path: '(file)',
        message: 'This file was made by a newer version of Mossnote. Update the app to open it.',
      },
    ]);
    expect(fs.existsSync(t.dir) && fs.existsSync(path.join(t.dir, 'backups'))).toBe(false);
  });

  it('reports malformed JSON as validation_failed', async () => {
    const res = await t.raw('POST', '/api/data/import', {
      headers: {
        host: '127.0.0.1:4317',
        'content-type': 'application/json',
        'x-moss-client': 'web',
      },
      body: '{not json',
    });
    expect((await api.error(res, 400)).message).toBe("That file isn't valid JSON.");
  });

  it('points at the exact field: dates, links, tags, ids, progress, harvest, content', async () => {
    const file = await valid();
    const mutate = (fn: (f: ExportFile) => void) => {
      const copy = structuredClone(file);
      fn(copy);
      return copy;
    };
    const paths = async (fn: (f: ExportFile) => void) =>
      (await errors(mutate(fn))).map((e) => e.path);

    expect(
      await paths((f) => {
        const n = f.notes[0];
        if (n) n.gameDate = { year: 1, season: 0, day: 99 };
      }),
    ).toEqual(['notes[0].gameDate']);
    expect(
      await paths((f) => {
        const n = f.notes[1];
        if (n) n.links = [{ type: 'person', id: newId() }];
      }),
    ).toEqual(['notes[1].links[0]']);
    expect(
      await paths((f) => {
        const n = f.notes[0];
        if (n) n.tags = ['not-declared'];
      }),
    ).toEqual(['notes[0].tags[0]']);
    expect(
      await paths((f) => {
        const n = f.notes[1];
        if (n) n.id = f.notes[0]?.id ?? n.id;
      }),
    ).toContain('notes[1].id');
    expect(
      await paths((f) => {
        const p = f.people[0];
        if (p) p.progress = 9;
      }),
    ).toEqual(['people[0].progress']);
    expect(
      await paths((f) => {
        const p = f.plantings[0];
        if (p) p.harvestedOn = { year: 1, season: 0, day: 1 };
      }),
    ).toEqual(['plantings[0].harvestedOn']);
    expect(
      await paths((f) => {
        const n = f.notes[0];
        if (n) {
          n.title = null;
          n.body = '  ';
        }
      }),
    ).toEqual(['notes[0].body']);
    expect(
      await paths((f) => {
        f.settings.currentGameDate = { year: 1, season: 7, day: 1 };
      }),
    ).toEqual(['settings.currentGameDate']);
    expect(
      await paths((f) => {
        const n = f.notes[0];
        if (n) n.links = [{ type: 'note', id: n.id }];
      }),
    ).toEqual(['notes[0].links[0]']);
    expect(
      await paths((f) => {
        const q = f.notes[2]?.question;
        if (q) {
          q.solvedAt = '2026-01-01T00:00:00.000Z';
        }
      }),
    ).toEqual(['notes[2].question']);
  });

  it('reports shape errors with indexed paths, and many at once', async () => {
    const file = await valid();
    const broken = structuredClone(file) as unknown as {
      notes: Record<string, unknown>[];
      people: Record<string, unknown>[];
    };
    broken.notes[0] = { ...broken.notes[0], isDiscovery: 'yes', createdAt: 'yesterday' };
    broken.people[0] = { ...broken.people[0], name: '' };
    const list = await errors(broken);
    const paths = list.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(['notes[0].isDiscovery', 'notes[0].createdAt', 'people[0].name']),
    );
  });

  it('ignores unknown fields with a warning', async () => {
    const file = (await valid()) as ExportFile & Record<string, unknown>;
    const extra = structuredClone(file);
    (extra as Record<string, unknown>).mystery = 1;
    (extra.notes[0] as unknown as Record<string, unknown>).colour = 'red';
    const summary = await api.json<ImportSummary>(await importFile(extra, api, true));
    expect(summary.errors).toEqual([]);
    expect([...summary.warnings].sort()).toEqual([
      'Ignored unknown field mystery.',
      'Ignored unknown field notes[0].colour.',
    ]);
    expect((await importFile(extra)).status).toBe(200);
  });

  it('limits: a 2 MB body is refused elsewhere but accepted by import (50 MB)', async () => {
    const big = { prefs: { readingSize: 'x'.repeat(2_000_000) } };
    expect((await api.error(await t.call('PATCH', '/api/settings', big), 413)).code).toBe(
      'too_large',
    );
    const summary = await api.json<ImportSummary>(
      await importFile(
        { format: 'mossnote', formatVersion: 1, pad: 'x'.repeat(2_000_000) },
        api,
        true,
      ),
    );
    expect(summary.errors.length).toBeGreaterThan(0);
  });
});

describe('import is all or nothing', () => {
  it('takes a pre-import snapshot first', async () => {
    const file = await (async () => {
      await seedRichJournal();
      return exportJson();
    })();
    const res = await api.json<{ counts: { notes: number }; snapshot: string }>(
      await importFile(file),
    );
    expect(res.counts.notes).toBe(3);
    expect(res.snapshot).toMatch(/^journal-\d{8}-\d{4}(-\d+)?-pre-import\.db$/);
    expect(fs.existsSync(path.join(t.dir, 'backups', res.snapshot))).toBe(true);
    const backups = await api.json<{ items: BackupInfo[] }>(
      await t.call('GET', '/api/data/backups'),
    );
    expect(backups.items.map((b) => b.reason)).toContain('pre-import');
  });

  it('the snapshot holds the journal as it was before the import', async () => {
    await api.note({ body: 'before the import' });
    const file = structuredClone(await exportJson());
    file.notes = [];
    const res = await api.json<{ snapshot: string }>(await importFile(file));
    expect((await api.notes()).items).toEqual([]);
    const { default: Database } = await import('better-sqlite3');
    const snap = new Database(path.join(t.dir, 'backups', res.snapshot), { readonly: true });
    expect(snap.prepare('SELECT count(*) AS n FROM notes').get()).toEqual({ n: 1 });
    snap.close();
  });

  it('a failure part way rolls everything back and names the snapshot', async () => {
    await seedRichJournal();
    const original = await exportJson();
    t.database.sqlite.exec(`CREATE TRIGGER fail_import BEFORE INSERT ON notes
      WHEN new.body = 'Question note' BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
    const changed = structuredClone(original);
    changed.people = [];
    changed.maps = changed.maps.map((m) => ({
      ...m,
      pins: m.pins.map((p) => ({ ...p, target: null })),
    }));
    changed.notes = changed.notes.map((n) => ({ ...n, links: [] }));
    const error = await api.error(await importFile(changed), 500);
    expect(error.message).toBe('Import failed. Your journal is unchanged.');
    expect(error.details?.snapshot).toMatch(/pre-import/);
    t.database.sqlite.exec('DROP TRIGGER fail_import');
    expect(withoutTime(await exportJson())).toEqual(withoutTime(original));
    api.expectIndexConsistent();
  });
});

describe('Markdown export', () => {
  it('contains every live note, person and farm entry in a readable layout', async () => {
    const { person } = await seedRichJournal();
    const gone = await api.note({ body: 'must not appear' });
    await t.call('DELETE', `/api/notes/${gone.id}`);
    const res = await t.call('GET', '/api/data/export.md');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="mossnote-\d{4}-\d{2}-\d{2}\.md"$/,
    );
    const md = await res.text();
    expect(md.startsWith('# Mossnote\nExported ')).toBe(true);
    expect(md).toMatch(/Exported \d{4}-\d{2}-\d{2} · 3 notes · 1 people · 1 farm entries/);
    expect(md).not.toContain('must not appear');
    expect(md).toContain('## Journal');
    expect(md).toContain('### Year 1 · Late Frost 5');
    expect(md).toContain('**A title** ✦');
    expect(md).toContain('Body with **markdown** and <b>html</b>\nsecond line');
    expect(md).toContain('#idea');
    expect(md).toContain('Linked: A title, Example entry, Example Person');
    expect(md).toContain('## Not dated');
    expect(md).toContain('## Questions');
    expect(md).toContain('### Open');
    expect(md).toContain('### Solved');
    expect(md).toContain('Answer: Example answer.');
    expect(md).toContain('## People');
    expect(md).toContain(`### ${person.name}`);
    expect(md).toContain('Progress 2 of 5');
    expect(md).toContain('- Label: Value');
    expect(md).toContain('## Farm');
    expect(md).toContain(
      '- Example entry: planted Thaw 3, harvested Bloom 4 · planted 4, harvested 7',
    );
  });

  it('journal order is oldest first, and oldest first within a day', async () => {
    await api.note({ body: 'second day later', gameDate: k(1, 0, 2) });
    await api.note({ body: 'first day', gameDate: k(1, 0, 1) });
    await api.note({ body: 'second day earlier-created', gameDate: k(1, 0, 2) });
    const md = await (await t.call('GET', '/api/data/export.md')).text();
    const order = ['first day', 'second day later', 'second day earlier-created'].map((s) =>
      md.indexOf(s),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(md.indexOf('### Year 1 · Spring 1')).toBeLessThan(md.indexOf('### Year 1 · Spring 2'));
  });

  it('omits empty sections', async () => {
    await api.note({ body: 'only a note', gameDate: k(1, 0, 1) });
    const md = await (await t.call('GET', '/api/data/export.md')).text();
    for (const heading of ['## Not dated', '## Questions', '## People', '## Farm'])
      expect(md).not.toContain(heading);
    expect(md).toContain('## Journal');
  });
});

describe('storage facts and backups', () => {
  it('reports the data folder, counts, and the last backup time', async () => {
    await api.note({ body: 'x', tags: ['a'] });
    await api.person({ name: 'P' });
    const before = await api.json<DataInfo>(await t.call('GET', '/api/data/info'));
    expect(before).toMatchObject({
      dataDir: t.dir,
      counts: { notes: 1, people: 1, plantings: 0, tags: 1 },
      lastBackupAt: null,
    });
    const made = await api.json<BackupInfo>(await t.call('POST', '/api/data/backup'));
    expect(made).toMatchObject({
      reason: 'manual',
      name: expect.stringMatching(/-manual\.db$/) as string,
    });
    const after = await api.json<DataInfo>(await t.call('GET', '/api/data/info'));
    expect(after.lastBackupAt).toBe(made.takenAt);
  });

  it('lists snapshots newest first, and manual ones are never pruned', async () => {
    for (let i = 0; i < 20; i++) {
      api.tick(120_000);
      await t.call('POST', '/api/data/backup');
    }
    const { items } = await api.json<{ items: BackupInfo[] }>(
      await t.call('GET', '/api/data/backups'),
    );
    expect(items).toHaveLength(20);
    expect(items.map((b) => b.takenAt)).toEqual([...items.map((b) => b.takenAt)].sort().reverse());
  });
});

describe('recently deleted', () => {
  const trash = async (kind = '') =>
    (
      await api.json<{ items: { kind: string; id: string; label: string; deletedAt: string }[] }>(
        await t.call('GET', `/api/trash${kind}`),
      )
    ).items;

  it('lists deleted records with the time of deletion, newest first, and filters by kind', async () => {
    const note = await api.note({ title: 'Deleted note', body: 'x' });
    const person = await api.person({ name: 'Deleted person' });
    const entry = await api.planting({ label: 'Deleted entry' });
    for (const [kind, id] of [
      ['notes', note.id],
      ['people', person.id],
      ['plantings', entry.id],
    ] as const) {
      api.tick();
      await t.call('DELETE', `/api/${kind}/${id}`);
    }
    const all = await trash();
    expect(all.map((i) => `${i.kind}:${i.label}`)).toEqual([
      'planting:Deleted entry',
      'person:Deleted person',
      'note:Deleted note',
    ]);
    expect(Date.parse(all[0]?.deletedAt ?? '')).toBeGreaterThan(
      Date.parse(all[2]?.deletedAt ?? ''),
    );
    expect((await trash('?kind=person')).map((i) => i.id)).toEqual([person.id]);
  });

  it('restores each kind, with tags and links', async () => {
    const person = await api.person({ name: 'P', tags: ['t'] });
    const note = await api.note({
      body: 'n',
      tags: ['t'],
      links: [{ type: 'person', id: person.id }],
    });
    await t.call('DELETE', `/api/notes/${note.id}`);
    await t.call('DELETE', `/api/people/${person.id}`);
    await t.call('POST', `/api/trash/person/${person.id}/restore`);
    await t.call('POST', `/api/trash/note/${note.id}/restore`);
    expect((await api.getNote(note.id)).links.map((l) => l.id)).toEqual([person.id]);
    expect(await trash()).toEqual([]);
    await api.error(await t.call('POST', `/api/trash/note/${note.id}/restore`), 404);
  });

  it('delete forever removes the row and its join and link rows', async () => {
    const person = await api.person({ name: 'P', tags: ['t'] });
    const note = await api.note({
      body: 'n',
      tags: ['t'],
      links: [{ type: 'person', id: person.id }],
    });
    const other = await api.note({ body: 'other', links: [{ type: 'note', id: note.id }] });
    await t.call('DELETE', `/api/notes/${note.id}`);
    expect((await t.call('DELETE', `/api/trash/note/${note.id}`)).status).toBe(204);
    expect(
      t.database.sqlite.prepare('SELECT count(*) AS n FROM notes WHERE id = ?').get(note.id),
    ).toEqual({ n: 0 });
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM note_tags').get()).toEqual({
      n: 0,
    });
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM links').get()).toEqual({ n: 0 });
    expect((await api.getNote(other.id)).links).toEqual([]);
    api.expectNoOrphans();
    await api.error(await t.call('DELETE', `/api/trash/note/${note.id}`), 404);
  });

  it('only records that are in the trash can be deleted forever', async () => {
    const live = await api.note({ body: 'live' });
    await api.error(await t.call('DELETE', `/api/trash/note/${live.id}`), 404);
    expect((await api.getNote(live.id)).body).toBe('live');
  });

  it('empties the trash without touching live records', async () => {
    const keep = await api.note({ body: 'keep' });
    for (let i = 0; i < 3; i++) {
      const n = await api.note({ body: `gone ${i}` });
      await t.call('DELETE', `/api/notes/${n.id}`);
    }
    const res = await api.json<{ removed: number }>(await t.call('DELETE', '/api/trash'));
    expect(res.removed).toBe(3);
    expect(await trash()).toEqual([]);
    expect((await api.notes()).items.map((n) => n.id)).toEqual([keep.id]);
  });

  it('records deleted more than 30 days ago are purged, newer ones are kept', async () => {
    const { purgeOldTrash } = await import('../services/trash');
    const old = await api.note({ body: 'old' });
    const recent = await api.note({ body: 'recent' });
    await t.call('DELETE', `/api/notes/${old.id}`);
    api.tick(29 * 24 * 3_600_000);
    await t.call('DELETE', `/api/notes/${recent.id}`);
    api.tick(2 * 24 * 3_600_000);
    expect(purgeOldTrash({ sqlite: t.database.sqlite, clock: t.clock })).toBe(1);
    expect((await trash()).map((i) => i.id)).toEqual([recent.id]);
  });

  it('deleted records are absent from lists, search, counts and exports', async () => {
    const note = await api.note({ body: 'zebra', tags: ['t'] });
    await t.call('DELETE', `/api/notes/${note.id}`);
    expect((await api.notes()).items).toEqual([]);
    expect((await api.json<{ count: number }>(await t.call('GET', '/api/notes/count'))).count).toBe(
      0,
    );
    expect(
      (await api.json<SearchResponse>(await t.call('GET', '/api/search?q=zebra'))).groups.notes,
    ).toEqual([]);
    expect((await exportJson()).notes).toEqual([]);
    expect((await api.tags())[0]?.counts.notes).toBe(0);
  });
});
