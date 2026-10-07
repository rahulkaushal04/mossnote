import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '@shared/constants';
import { encode } from '@shared/gameDate';
import type { ApiErrorBody } from '@shared/errors';
import type { Settings } from '@shared/schemas/settings';
import { makeTestApp, type TestApp } from '../testing/app';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(() => {
  t.close();
});

const get = async () => (await (await t.call('GET', '/api/settings')).json()) as Settings;
const patch = (body: unknown) => t.call('PATCH', '/api/settings', body);
const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error;
const k = (year: number, season: number, day: number) => encode({ year, season, day });

const addNote = (id: string, gameDate: number | null, solvedGameDate: number | null = null) => {
  const solved = solvedGameDate !== null;
  t.database.sqlite
    .prepare(
      'INSERT INTO notes (id, body, game_date, question_state, solved_game_date, solved_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)',
    )
    .run(id, 'text', gameDate, solved ? 'solved' : null, solvedGameDate, solved ? 1 : null);
};
const addPlanting = (id: string, plantedOn: number | null, harvestedOn: number | null = null) => {
  t.database.sqlite
    .prepare(
      'INSERT INTO plantings (id, label, planted_on, harvested_on, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)',
    )
    .run(id, 'Example entry', plantedOn, harvestedOn);
};

describe('GET /api/settings', () => {
  it('returns the defaults of a fresh journal', async () => {
    const settings = await get();
    expect(settings.calendar).toEqual(DEFAULT_CALENDAR);
    expect(settings.currentGameDate).toBeNull();
    expect(settings.prefs).toEqual({ readingSize: 'comfortable', hintDismissed: false });
    expect(settings.meta.journalName).toBe('journal');
  });
});

describe('PATCH currentGameDate', () => {
  it('sets, changes and clears the current date', async () => {
    let res = await patch({ currentGameDate: k(1, 0, 3) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Settings).currentGameDate).toBe(10_003);
    expect((await get()).currentGameDate).toBe(10_003);

    res = await patch({ currentGameDate: k(2, 3, 28) });
    expect(((await res.json()) as Settings).currentGameDate).toBe(20_328);

    res = await patch({ currentGameDate: null });
    expect(((await res.json()) as Settings).currentGameDate).toBeNull();
  });

  it('rejects dates that are not in the calendar, naming the field', async () => {
    for (const bad of [k(1, 0, 29), k(1, 4, 1), k(0, 0, 1), 10_000, 5]) {
      const res = await patch({ currentGameDate: bad });
      expect(res.status, String(bad)).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe('validation_failed');
      expect(error.message).toBe("That date isn't in your calendar.");
      expect(error.fields).toEqual({ currentGameDate: "That date isn't in your calendar." });
    }
    expect((await get()).currentGameDate).toBeNull();
  });

  it('rejects non-integers and wrong types', async () => {
    for (const bad of [1.5, '10003', true, [], {}]) {
      expect((await patch({ currentGameDate: bad })).status).toBe(400);
    }
  });

  it('validates a new date against a calendar sent in the same request', async () => {
    const res = await patch({
      calendar: { seasons: [{ name: 'Only', days: 5 }] },
      currentGameDate: k(1, 0, 5),
    });
    expect(res.status).toBe(200);
    const bad = await patch({
      calendar: { seasons: [{ name: 'Only', days: 5 }] },
      currentGameDate: k(1, 0, 6),
    });
    expect(bad.status).toBe(400);
  });
});

describe('PATCH calendar', () => {
  it('renaming a season changes labels and leaves stored keys alone', async () => {
    addNote('n1', k(1, 0, 3));
    const renamed = structuredClone(DEFAULT_CALENDAR);
    renamed.seasons[0] = { name: 'Thaw', days: 28 };
    const res = await patch({ calendar: renamed });
    expect(res.status).toBe(200);
    expect((await get()).calendar.seasons[0]?.name).toBe('Thaw');
    const row = t.database.sqlite.prepare("SELECT game_date FROM notes WHERE id = 'n1'").get();
    expect(row).toEqual({ game_date: 10_003 });
  });

  it('adds, removes and resizes seasons that no stored date uses', async () => {
    const calendar = {
      seasons: [
        { name: 'One', days: 10 },
        { name: 'Two', days: 99 },
        { name: 'Three', days: 1 },
      ],
    };
    expect((await patch({ calendar })).status).toBe(200);
    expect((await get()).calendar).toEqual(calendar);
  });

  it('refuses to cut days below one in use, stating the count and changing nothing', async () => {
    addNote('n1', k(1, 0, 20));
    addNote('n2', k(2, 0, 20));
    addNote('n3', k(1, 0, 5));
    const smaller = structuredClone(DEFAULT_CALENDAR);
    smaller.seasons[0] = { name: 'Spring', days: 10 };
    const res = await patch({ calendar: smaller });
    expect(res.status).toBe(409);
    const error = await errorOf(res);
    expect(error.code).toBe('conflict');
    expect(error.message).toBe('2 notes use day 20 of Spring.');
    expect(error.details).toMatchObject({
      affected: { notes: 2, plantings: 0, currentGameDate: false },
    });
    expect((await get()).calendar).toEqual(DEFAULT_CALENDAR);
  });

  it('uses the singular for one affected note', async () => {
    addNote('n1', k(1, 1, 28));
    const smaller = structuredClone(DEFAULT_CALENDAR);
    smaller.seasons[1] = { name: 'Summer', days: 27 };
    const error = await errorOf(await patch({ calendar: smaller }));
    expect(error.message).toBe('1 note uses day 28 of Summer.');
  });

  it('counts farm entries and says "records" when they are involved', async () => {
    addNote('n1', k(1, 0, 20));
    addPlanting('f1', k(1, 0, 25), k(1, 0, 27));
    const smaller = structuredClone(DEFAULT_CALENDAR);
    smaller.seasons[0] = { name: 'Spring', days: 10 };
    const error = await errorOf(await patch({ calendar: smaller }));
    expect(error.message).toBe('3 records use day 27 of Spring.');
    expect(error.details).toMatchObject({ affected: { notes: 1, plantings: 2 } });
  });

  it('notices solved dates and soft-deleted rows too', async () => {
    addNote('n1', k(1, 0, 1), k(1, 0, 26));
    t.database.sqlite.prepare("UPDATE notes SET deleted_at = 5 WHERE id = 'n1'").run();
    const smaller = structuredClone(DEFAULT_CALENDAR);
    smaller.seasons[0] = { name: 'Spring', days: 25 };
    expect((await patch({ calendar: smaller })).status).toBe(409);
  });

  it('refuses to remove a season that is in use', async () => {
    addNote('n1', k(1, 3, 2));
    addNote('n2', k(1, 3, 9));
    const fewer = { seasons: DEFAULT_CALENDAR.seasons.slice(0, 3) };
    const res = await patch({ calendar: fewer });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).message).toBe('2 notes use Winter, which would be removed.');
    expect((await get()).calendar.seasons).toHaveLength(4);
  });

  it('allows removing a season no date uses', async () => {
    addNote('n1', k(1, 2, 2));
    const fewer = { seasons: DEFAULT_CALENDAR.seasons.slice(0, 3) };
    expect((await patch({ calendar: fewer })).status).toBe(200);
  });

  it('refuses a calendar that would invalidate the current game date', async () => {
    await patch({ currentGameDate: k(1, 0, 20) });
    const smaller = structuredClone(DEFAULT_CALENDAR);
    smaller.seasons[0] = { name: 'Spring', days: 10 };
    const res = await patch({ calendar: smaller });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).details).toMatchObject({ affected: { currentGameDate: true } });
    expect((await get()).currentGameDate).toBe(k(1, 0, 20));
  });

  it('allows the same calendar and clears nothing when only labels change', async () => {
    await patch({ currentGameDate: k(1, 0, 20) });
    const renamed = structuredClone(DEFAULT_CALENDAR);
    renamed.seasons[0] = { name: 'Thaw', days: 28 };
    expect((await patch({ calendar: renamed })).status).toBe(200);
    expect((await get()).currentGameDate).toBe(k(1, 0, 20));
  });
});

describe('calendar validation', () => {
  const invalid = async (calendar: unknown) => {
    const res = await patch({ calendar });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe('validation_failed');
    return error;
  };

  it('needs 1 to 12 seasons', async () => {
    await invalid({ seasons: [] });
    await invalid({ seasons: Array.from({ length: 13 }, (_, i) => ({ name: `S${i}`, days: 5 })) });
    expect((await patch({ calendar: { seasons: [{ name: 'A', days: 1 }] } })).status).toBe(200);
    const twelve = Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, days: 5 }));
    expect((await patch({ calendar: { seasons: twelve } })).status).toBe(200);
  });

  it('needs names of 1 to 20 characters, unique ignoring case', async () => {
    await invalid({ seasons: [{ name: '', days: 5 }] });
    await invalid({ seasons: [{ name: '   ', days: 5 }] });
    await invalid({ seasons: [{ name: 'x'.repeat(21), days: 5 }] });
    const dup = await invalid({
      seasons: [
        { name: 'Spring', days: 5 },
        { name: 'SPRING', days: 5 },
      ],
    });
    expect(dup.fields).toHaveProperty(['calendar.seasons.1.name']);
    expect(
      (await patch({ calendar: { seasons: [{ name: 'x'.repeat(20), days: 5 }] } })).status,
    ).toBe(200);
  });

  it('needs whole days from 1 to 99', async () => {
    for (const days of [0, -1, 100, 2.5, '5']) {
      const error = await invalid({ seasons: [{ name: 'A', days }] });
      expect(error.fields).toHaveProperty(['calendar.seasons.0.days']);
    }
  });

  it('rejects unknown fields', async () => {
    await invalid({ seasons: [{ name: 'A', days: 5, extra: true }] });
    await invalid({ seasons: [{ name: 'A', days: 5 }], extra: true });
  });
});

describe('PATCH prefs and request shape', () => {
  it('merges prefs field by field', async () => {
    await patch({ prefs: { readingSize: 'large' } });
    let settings = await get();
    expect(settings.prefs).toEqual({ readingSize: 'large', hintDismissed: false });
    await patch({ prefs: { hintDismissed: true } });
    settings = await get();
    expect(settings.prefs).toEqual({ readingSize: 'large', hintDismissed: true });
  });

  it('rejects bad prefs and unknown fields', async () => {
    expect((await patch({ prefs: { readingSize: 'huge' } })).status).toBe(400);
    expect((await patch({ prefs: { theme: 'dark' } })).status).toBe(400);
    expect((await patch({ unknown: 1 })).status).toBe(400);
    expect((await patch({ meta: { journalName: 'x' } })).status).toBe(400);
  });

  it('accepts an empty patch and changes nothing', async () => {
    const before = await get();
    expect((await patch({})).status).toBe(200);
    expect(await get()).toEqual(before);
  });

  it('returns validation_failed for malformed JSON', async () => {
    const res = await t.raw('PATCH', '/api/settings', {
      headers: {
        host: '127.0.0.1:4317',
        'content-type': 'application/json',
        'x-moss-client': 'web',
      },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('validation_failed');
  });

  it('returns too_large (413) over 1 MB', async () => {
    const res = await t.raw('PATCH', '/api/settings', {
      headers: {
        host: '127.0.0.1:4317',
        'content-type': 'application/json',
        'x-moss-client': 'web',
      },
      body: JSON.stringify({ prefs: { readingSize: 'x'.repeat(1_100_000) } }),
    });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('too_large');
  });

  it('only ever stores the documented setting keys', async () => {
    await patch({ currentGameDate: k(1, 0, 3), prefs: { hintDismissed: true } });
    const keys = (
      t.database.sqlite.prepare('SELECT key FROM settings ORDER BY key').all() as { key: string }[]
    ).map((r) => r.key);
    expect(keys).toEqual(['calendar', 'currentGameDate', 'meta', 'prefs']);
  });
});

describe('error shape', () => {
  it('uses the JSON error shape for unknown routes', async () => {
    const res = await t.call('GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });
});

describe('layout (templates and sections)', () => {
  const layout = {
    template: 'stardew',
    order: ['maps', 'today', 'journal', 'people', 'farm'],
    hidden: ['farm'],
    labels: { people: 'Neighbours' },
    quickActions: false,
  };

  it('starts as the default template and stores nothing until it changes', async () => {
    expect((await get()).layout).toEqual({
      template: 'default',
      order: [],
      hidden: [],
      labels: {},
      quickActions: true,
    });
    const keys = (
      t.database.sqlite.prepare('SELECT key FROM settings ORDER BY key').all() as { key: string }[]
    ).map((r) => r.key);
    expect(keys).not.toContain('layout');
  });

  it('saves and returns a layout', async () => {
    const res = await patch({ layout });
    expect(res.status).toBe(200);
    expect((await get()).layout).toEqual(layout);
  });

  it('rejects unknown sections, empty names and extra fields', async () => {
    for (const bad of [
      { ...layout, order: ['nowhere'] },
      { ...layout, labels: { people: '   ' } },
      { ...layout, labels: { people: 'x'.repeat(31) } },
      { ...layout, extra: true },
    ]) {
      expect((await patch({ layout: bad })).status).toBe(400);
    }
  });

  it('survives an export and an import', async () => {
    await patch({ layout });
    const exported = (await (await t.call('GET', '/api/data/export.json')).json()) as {
      settings: { layout?: unknown };
    };
    expect(exported.settings.layout).toEqual(layout);
    await patch({ layout: { ...layout, template: 'default', labels: {} } });
    const res = await t.call('POST', '/api/data/import', exported);
    expect(res.status).toBe(200);
    expect((await get()).layout).toEqual(layout);
  });

  it('a default layout is left out of the export, and import resets to it', async () => {
    const plain = (await (await t.call('GET', '/api/data/export.json')).json()) as {
      settings: { layout?: unknown };
    };
    expect(plain.settings.layout).toBeUndefined();
    await patch({ layout });
    expect((await t.call('POST', '/api/data/import', plain)).status).toBe(200);
    expect((await get()).layout.template).toBe('default');
  });
});
