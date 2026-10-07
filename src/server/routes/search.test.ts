import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '@shared/constants';
import { encode } from '@shared/gameDate';
import type { SearchResponse } from '@shared/types';
import { Api } from '../testing/api';
import { makeTestApp, type TestApp } from '../testing/app';

let t: TestApp;
let api: Api;
beforeEach(async () => {
  t = await makeTestApp();
  api = new Api(t);
});
afterEach(() => {
  api.expectIndexConsistent();
  t.close();
});

const k = (year: number, season: number, day: number) => encode({ year, season, day });
const run = async (q: string, extra = ''): Promise<SearchResponse> =>
  api.json<SearchResponse>(await t.call('GET', `/api/search?q=${encodeURIComponent(q)}${extra}`));
const noteBodies = async (q: string) => (await run(q)).groups.notes.map((h) => h.id);

describe('matching', () => {
  it('a prefix of the last word finds the whole word', async () => {
    const n = await api.note({ body: 'The old harbour at dusk' });
    expect(await noteBodies('harb')).toEqual([n.id]);
    expect(await noteBodies('the harb')).toEqual([n.id]);
    expect(await noteBodies('ha')).toEqual([n.id]);
  });

  it('only the last word is a prefix; earlier words must match whole', async () => {
    const n = await api.note({ body: 'harbour lantern' });
    expect(await noteBodies('harbour lant')).toEqual([n.id]);
    // "harb" is not the last word, so it must match whole: nothing matches every word, and the
    // any-word retry then offers the lantern as a partial match.
    const res = await run('harb lantern');
    expect(res.partial).toBe(true);
    expect(await noteBodies('harb')).toEqual([n.id]);
  });

  it('tolerates a typo of one edit in a word of 4 to 7 characters', async () => {
    const n = await api.note({ body: 'The old harbour at dusk' });
    for (const typo of ['harbuor', 'harbor', 'harbur', 'harbourr', 'hharbour']) {
      expect(await noteBodies(typo), typo).toEqual([n.id]);
    }
    expect(await noteBodies('harbxxr')).toEqual([]);
  });

  it('tolerates two edits in a word of 8 or more characters, never in a short word', async () => {
    const long = await api.note({ body: 'a remarkable lantern' });
    expect(await noteBodies('remarkabel')).toEqual([long.id]);
    expect(await noteBodies('remrkabel')).toEqual([long.id]);
    expect(await noteBodies('lanxxxxn')).toEqual([]);
    await api.note({ body: 'cat sat' });
    expect(await noteBodies('cta')).toEqual([]);
    expect(await noteBodies('dat')).toEqual([]);
  });

  it('typo tolerance also applies to words that are not last', async () => {
    const n = await api.note({ body: 'harbour lantern' });
    expect(await noteBodies('harbuor lantern')).toEqual([n.id]);
  });

  it('is case-insensitive and accent-insensitive on both sides', async () => {
    const a = await api.note({ body: 'My Résumé is ready' });
    const b = await api.note({ body: 'a plain cafe' });
    expect(await noteBodies('RESUME')).toEqual([a.id]);
    expect(await noteBodies('résumé')).toEqual([a.id]);
    expect(await noteBodies('café')).toEqual([b.id]);
  });

  it('every word must match, in any order; phrases keep order; -word excludes', async () => {
    const both = await api.note({ body: 'a quiet corner near the lantern' });
    const one = await api.note({ body: 'only a lantern here' });
    expect(await noteBodies('lantern quiet')).toEqual([both.id]);
    expect(await noteBodies('"quiet corner"')).toEqual([both.id]);
    expect(await noteBodies('"corner quiet"')).toEqual([]);
    expect((await noteBodies('lantern')).sort()).toEqual([both.id, one.id].sort());
    expect(await noteBodies('lantern -quiet')).toEqual([one.id]);
    expect(await noteBodies('lantern -"quiet corner"')).toEqual([one.id]);
  });

  it('searches titles, resolutions, person names, farm entry names and date words', async () => {
    const person = await api.person({ name: 'Zorbin Example' });
    const entry = await api.planting({ label: 'Quillfruit row' });
    const note = await api.note({
      title: 'Findable title',
      body: 'plain',
      gameDate: k(1, 0, 3),
      question: { state: 'solved', resolution: 'Wombat answer' },
      links: [
        { type: 'person', id: person.id },
        { type: 'planting', id: entry.id },
      ],
    });
    for (const q of ['findable', 'wombat', 'zorbin', 'quillfruit']) {
      expect(await noteBodies(q), q).toContain(note.id);
    }
  });

  it('searches people notes and custom fields, and farm entry notes and custom fields', async () => {
    const person = await api.person({
      name: 'A',
      notes: 'likes marmalade',
      customFields: [{ label: 'Hobby', value: 'kites' }],
    });
    const entry = await api.planting({
      label: 'B',
      notes: 'north patch',
      customFields: [{ label: 'Soil', value: 'sandy' }],
    });
    const res = async (q: string) => run(q);
    expect((await res('marmalade')).groups.people.map((h) => h.id)).toEqual([person.id]);
    expect((await res('kites')).groups.people.map((h) => h.id)).toEqual([person.id]);
    expect((await res('hobby')).groups.people.map((h) => h.id)).toEqual([person.id]);
    expect((await res('patch')).groups.plantings.map((h) => h.id)).toEqual([entry.id]);
    expect((await res('sandy')).groups.plantings.map((h) => h.id)).toEqual([entry.id]);
  });

  it('neutralises FTS operators typed by the user', async () => {
    await api.note({ body: 'one and two or three not four near five' });
    for (const q of [
      '"',
      '""',
      '"unterminated',
      'AND',
      'OR',
      'NOT',
      'NEAR(a b)',
      'a AND b',
      '*',
      'a*',
      '(',
      ')',
      'a:b',
      'title:one',
      '^one',
      '-',
      '--',
      "'",
      'a "b" "',
      '\\',
      '{title}:one',
      'one OR two',
    ]) {
      const res = await t.call('GET', `/api/search?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
    }
    expect(await noteBodies('and')).toHaveLength(1);
    expect(await noteBodies('not')).toHaveLength(1);
  });

  it('caps the query at 200 characters', async () => {
    const res = await t.call('GET', `/api/search?q=${'a'.repeat(900)}`);
    expect(res.status).toBe(200);
  });
});

describe('structured filters', () => {
  async function seed() {
    const person = await api.person({ name: 'Sam Example' });
    return {
      tagged: await api.note({ body: 'lantern one', tags: ['idea'] }),
      other: await api.note({ body: 'lantern two' }),
      about: await api.note({ body: 'lantern three', links: [{ type: 'person', id: person.id }] }),
      open: await api.note({ body: 'lantern four', question: { state: 'open' } }),
      solved: await api.note({ body: 'lantern five', question: { state: 'solved' } }),
      disc: await api.note({ body: 'lantern six', isDiscovery: true }),
      dated: await api.note({ body: 'lantern seven', gameDate: k(2, 0, 3) }),
      dated2: await api.note({ body: 'lantern eight', gameDate: k(1, 1, 3) }),
    };
  }

  it('#tag, is:question, is:open, is:solved and is:discovery', async () => {
    const n = await seed();
    expect(await noteBodies('#idea')).toEqual([n.tagged.id]);
    expect(await noteBodies('#IDEA lantern')).toEqual([n.tagged.id]);
    expect(await noteBodies('#nothing')).toEqual([]);
    expect((await noteBodies('is:question')).sort()).toEqual([n.open.id, n.solved.id].sort());
    expect(await noteBodies('is:open')).toEqual([n.open.id]);
    expect(await noteBodies('is:solved')).toEqual([n.solved.id]);
    expect(await noteBodies('is:question is:open')).toEqual([n.open.id]);
    expect(await noteBodies('is:discovery')).toEqual([n.disc.id]);
    expect(await noteBodies('is:discovery lantern')).toEqual([n.disc.id]);
  });

  it('@Name finds notes linking a person whose name matches', async () => {
    const n = await seed();
    expect(await noteBodies('@Sam')).toEqual([n.about.id]);
    expect(await noteBodies('@sam lantern')).toEqual([n.about.id]);
    expect(await noteBodies('@"Sam Example"')).toEqual([n.about.id]);
    expect(await noteBodies('@Nobody')).toEqual([]);
  });

  it('game-date tokens filter by season, day and year, and combine with text', async () => {
    const n = await seed();
    expect(await noteBodies('spring 3')).toEqual([n.dated.id]);
    expect(await noteBodies('spring 3 y2')).toEqual([n.dated.id]);
    expect(await noteBodies('spring 3 y1')).toEqual([]);
    expect(await noteBodies('year 1 summer')).toEqual([n.dated2.id]);
    expect(await noteBodies('summer lantern')).toEqual([n.dated2.id]);
    expect((await noteBodies('spring')).sort()).toEqual([n.dated.id].sort());
    expect(await noteBodies('spring 4')).toEqual([]);
  });

  it('game-date tokens follow a renamed calendar and match farm entries', async () => {
    const entry = await api.planting({ label: 'Row', plantedOn: k(1, 0, 5) });
    await api.note({ body: 'dated', gameDate: k(1, 0, 5) });
    const renamed = structuredClone(DEFAULT_CALENDAR);
    renamed.seasons[0] = { name: 'Thaw', days: 28 };
    await t.call('PATCH', '/api/settings', { calendar: renamed });
    expect((await run('thaw 5')).groups.notes).toHaveLength(1);
    expect((await run('thaw 5')).groups.plantings.map((h) => h.id)).toEqual([entry.id]);
    // "spring" is no longer a season, so it is plain text and nothing contains it.
    const old = await run('spring 5');
    expect(old.partial).toBe(true);
    // The words in the index follow the rename too.
    api.expectIndexConsistent();
    const row = t.database.sqlite
      .prepare("SELECT extra FROM search_fts WHERE kind = 'note'")
      .get() as { extra: string };
    expect(row.extra).toContain('Thaw 5 Year 1');
  });

  it('in: limits the kinds; is: and @ limit to notes', async () => {
    await api.person({ name: 'Lantern Keeper' });
    await api.note({ body: 'lantern note' });
    await api.planting({ label: 'Lantern bed' });
    const all = await run('lantern');
    expect([
      all.groups.notes.length,
      all.groups.people.length,
      all.groups.plantings.length,
    ]).toEqual([1, 1, 1]);
    const people = await run('in:people lantern');
    expect([
      people.groups.notes.length,
      people.groups.people.length,
      people.groups.plantings.length,
    ]).toEqual([0, 1, 0]);
    expect((await run('in:farm lantern')).groups.plantings).toHaveLength(1);
    expect((await run('in:notes lantern')).groups.notes).toHaveLength(1);
    const flagged = await run('is:discovery lantern');
    expect([flagged.groups.people.length, flagged.groups.plantings.length]).toEqual([0, 0]);
  });

  it('exclusions work without positive terms', async () => {
    const keep = await api.note({ body: 'plain question', question: { state: 'open' } });
    await api.note({ body: 'draft question', question: { state: 'open' } });
    expect(await noteBodies('is:question -draft')).toEqual([keep.id]);
  });

  it('tags also match as a result group by name', async () => {
    await api.note({ body: 'x', tags: ['lanternfish', 'other'] });
    const res = await run('lanter');
    expect(res.groups.tags.map((h) => h.title)).toEqual(['lanternfish']);
    expect((await run('#lanternfish')).groups.tags).toEqual([]);
  });
});

describe('results', () => {
  it('returns grouped hits with titles, snippets and game dates', async () => {
    const note = await api.note({
      title: 'Lantern title',
      body: 'first line\n' + 'filler '.repeat(40) + 'the lantern is here',
      gameDate: k(1, 0, 3),
    });
    const res = await run('lantern');
    const [hit] = res.groups.notes;
    expect(hit).toMatchObject({ kind: 'note', id: note.id, gameDate: k(1, 0, 3) });
    expect(hit?.title).toBe('\u0001Lantern\u0002 title');
    expect(hit?.snippet).toContain('\u0001lantern\u0002');
    expect(hit?.snippet?.length).toBeLessThan(200);
  });

  it('stored HTML is returned as text, only our markers wrap matches', async () => {
    await api.note({ body: '<script>alert(1)</script> lantern <b>bold</b>' });
    const [hit] = (await run('lantern')).groups.notes;
    expect(hit?.snippet).toContain('<script>');
    expect(hit?.snippet?.replaceAll('\u0001', '').replaceAll('\u0002', '')).toContain(
      '<b>bold</b>',
    );
  });

  it('untitled notes are labelled by their first words', async () => {
    await api.note({ body: 'zebra stripes are unique' });
    expect((await run('zebra')).groups.notes[0]?.title).toBe('zebra stripes are unique');
  });

  it('ranks a title match above a body match, and limits each group', async () => {
    const body = await api.note({ body: 'marmalade' });
    const title = await api.note({ title: 'marmalade', body: 'x' });
    expect(await noteBodies('marmalade')).toEqual([title.id, body.id]);
    for (let i = 0; i < 8; i++) await api.note({ body: `sprocket ${i}` });
    expect((await run('sprocket', '&limit=5')).groups.notes).toHaveLength(5);
    expect((await run('sprocket')).groups.notes).toHaveLength(8);
  });

  it('an empty or whitespace query returns nothing', async () => {
    await api.note({ body: 'x' });
    for (const q of ['', '   ', '-', '""']) {
      const res = await run(q);
      expect(
        Object.values(res.groups).every((g) => g.length === 0),
        JSON.stringify(q),
      ).toBe(true);
    }
  });

  it('limits kinds with the kinds parameter', async () => {
    await api.person({ name: 'Lantern Keeper' });
    await api.note({ body: 'lantern' });
    const res = await run('lantern', '&kinds=people');
    expect([res.groups.notes.length, res.groups.people.length]).toEqual([0, 1]);
  });

  it('partial matches: retries with any word when nothing matches every word', async () => {
    const n = await api.note({ body: 'only lantern here' });
    const res = await run('lantern zebra');
    expect(res.partial).toBe(true);
    expect(res.groups.notes.map((h) => h.id)).toEqual([n.id]);
    const none = await run('zebra giraffe');
    expect(none.partial).toBe(false);
    expect(none.groups.notes).toEqual([]);
    expect((await run('lantern')).partial).toBe(false);
  });
});

describe('the index follows every change', () => {
  it('edits replace the old words', async () => {
    const n = await api.note({ body: 'alpha content' });
    await api.patchNote(n.id, { body: 'omega content' });
    expect(await noteBodies('alpha')).toEqual([]);
    expect(await noteBodies('omega')).toEqual([n.id]);
  });

  it('a deleted note is not found; undo finds it again', async () => {
    const n = await api.note({ body: 'findable lantern' });
    await t.call('DELETE', `/api/notes/${n.id}`);
    expect(await noteBodies('lantern')).toEqual([]);
    api.expectIndexConsistent();
    await t.call('POST', `/api/notes/${n.id}/restore`);
    expect(await noteBodies('lantern')).toEqual([n.id]);
  });

  it('deleted people and farm entries are not found, and come back on restore', async () => {
    const person = await api.person({ name: 'Zorbin' });
    const entry = await api.planting({ label: 'Quillfruit' });
    await t.call('DELETE', `/api/people/${person.id}`);
    await t.call('DELETE', `/api/plantings/${entry.id}`);
    expect((await run('zorbin')).groups.people).toEqual([]);
    expect((await run('quillfruit')).groups.plantings).toEqual([]);
    await t.call('POST', `/api/people/${person.id}/restore`);
    await t.call('POST', `/api/plantings/${entry.id}/restore`);
    expect((await run('zorbin')).groups.people).toHaveLength(1);
    expect((await run('quillfruit')).groups.plantings).toHaveLength(1);
  });

  it('renaming a person moves the name in every linked note', async () => {
    const person = await api.person({ name: 'Oldname' });
    const note = await api.note({ body: 'plain', links: [{ type: 'person', id: person.id }] });
    expect(await noteBodies('oldname')).toEqual([note.id]);
    await t.call('PATCH', `/api/people/${person.id}`, { name: 'Newname' });
    expect(await noteBodies('oldname')).toEqual([]);
    expect(await noteBodies('newname')).toEqual([note.id]);
    await t.call('DELETE', `/api/people/${person.id}`);
    expect(await noteBodies('newname')).toEqual([]);
  });

  it('removing a link or a tag removes those words from the note', async () => {
    const person = await api.person({ name: 'Linked' });
    const note = await api.note({
      body: 'plain',
      tags: ['marker'],
      links: [{ type: 'person', id: person.id }],
    });
    await api.patchNote(note.id, { tags: [], links: [] });
    expect(await noteBodies('marker')).toEqual([]);
    expect(await noteBodies('linked')).toEqual([]);
  });

  it('reindexing from the tables reproduces the same index', async () => {
    const person = await api.person({ name: 'P', tags: ['t1'] });
    await api.planting({ label: 'E', plantedOn: k(1, 0, 1) });
    await api.note({
      body: 'x',
      tags: ['t1'],
      gameDate: k(1, 2, 3),
      links: [{ type: 'person', id: person.id }],
    });
    const snapshot = () =>
      JSON.stringify(
        t.database.sqlite
          .prepare(
            'SELECT kind, ref_id, title, body, tags, extra FROM search_fts ORDER BY kind, ref_id',
          )
          .all(),
      );
    const before = snapshot();
    const { reindexAll } = await import('../services/search-index');
    const { createCtx } = await import('../services/ctx');
    const ctx = createCtx({
      db: t.database.db,
      sqlite: t.database.sqlite,
      clock: t.clock,
      config: (await import('../testing/app')).testConfig(),
    });
    expect(reindexAll(ctx)).toEqual({ notes: 1, people: 1, plantings: 1 });
    expect(snapshot()).toBe(before);
  });
});
