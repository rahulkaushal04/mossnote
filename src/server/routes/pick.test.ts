import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encode } from '@shared/gameDate';
import type { PickItem } from '@shared/types';
import { Api } from '../testing/api';
import { makeTestApp, type TestApp } from '../testing/app';

let t: TestApp;
let api: Api;
beforeEach(async () => {
  t = await makeTestApp();
  api = new Api(t);
});
afterEach(() => {
  t.close();
});

const pick = async (kind: string, q = '', extra = ''): Promise<PickItem[]> =>
  (
    await api.json<{ items: PickItem[] }>(
      await t.call('GET', `/api/pick?kind=${kind}&q=${encodeURIComponent(q)}${extra}`),
    )
  ).items;
const labels = (items: PickItem[]) => items.map((i) => i.label);

describe('tags', () => {
  it('prefix matches come before substring matches, then by recent use', async () => {
    await api.note({ body: 'a', tags: ['grid'] });
    await api.note({ body: 'b', tags: ['idea'] });
    await api.note({ body: 'c', tags: ['ideal-thing'] });
    await api.note({ body: 'd', tags: ['valid'] });
    expect(labels(await pick('tag', 'id'))).toEqual(['ideal-thing', 'idea', 'valid', 'grid']);
  });

  it('an empty query lists tags by recent use; a leading # is ignored; exclude removes ids', async () => {
    await api.note({ body: 'old', tags: ['older'] });
    await api.note({ body: 'new', tags: ['newer'] });
    expect(labels(await pick('tag'))).toEqual(['newer', 'older']);
    expect(labels(await pick('tag', '#new'))).toEqual(['newer']);
    const [first] = await pick('tag');
    expect(labels(await pick('tag', '', `&exclude=${first?.id}`))).toEqual(['older']);
  });

  it('handles LIKE wildcards in the query literally', async () => {
    await api.note({ body: 'a', tags: ['plain'] });
    expect(await pick('tag', '%')).toEqual([]);
    expect(await pick('tag', '_')).toEqual([]);
  });

  it('is case-insensitive and respects the limit', async () => {
    for (const name of ['Alpha', 'alpine', 'ALTO', 'also'])
      await api.note({ body: name, tags: [name] });
    expect((await pick('tag', 'AL')).length).toBe(4);
    expect(await pick('tag', 'al', '&limit=2')).toHaveLength(2);
  });
});

describe('people', () => {
  it('matches the start of the name first, then anywhere, recently linked first', async () => {
    const sam = await api.person({ name: 'Sam Example' });
    await api.person({ name: 'Samantha Example' });
    await api.person({ name: 'Example Sam' });
    await api.note({ body: 'about sam', links: [{ type: 'person', id: sam.id }] });
    expect(labels(await pick('person', 'sam'))).toEqual([
      'Sam Example',
      'Samantha Example',
      'Example Sam',
    ]);
  });

  it('skips deleted people and excluded ids; an empty query returns everyone, capped', async () => {
    const a = await api.person({ name: 'Aaa' });
    const b = await api.person({ name: 'Bbb' });
    await t.call('DELETE', `/api/people/${a.id}`);
    expect(labels(await pick('person'))).toEqual(['Bbb']);
    expect(await pick('person', '', `&exclude=${b.id}`)).toEqual([]);
    for (let i = 0; i < 12; i++) await api.person({ name: `Extra ${i}` });
    expect(await pick('person')).toHaveLength(8);
  });
});

describe('notes and farm entries', () => {
  it('an empty query returns the most recently updated, 8 at most', async () => {
    for (let i = 0; i < 10; i++) await api.note({ body: `note ${i}` });
    const items = await pick('note');
    expect(items).toHaveLength(8);
    expect(items[0]?.label).toBe('note 9');
  });

  it('matches by prefix on title and the start of the body, labels with date and first words', async () => {
    const note = await api.note({
      title: 'Quillfruit plan',
      body: 'later',
      gameDate: encode({ year: 1, season: 0, day: 3 }),
    });
    await api.note({ body: 'unrelated' });
    const items = await pick('note', 'quillf');
    expect(items).toEqual([
      { kind: 'note', id: note.id, label: 'Quillfruit plan', detail: 'Spring 3 · Year 1' },
    ]);
    expect(labels(await pick('note', 'later'))).toEqual(['Quillfruit plan']);
  });

  it('untitled notes are labelled with the first 60 characters of the body', async () => {
    const body = 'x'.repeat(80);
    await api.note({ body });
    expect((await pick('note'))[0]?.label).toBe(`${'x'.repeat(60)}…`);
  });

  it('farm entries match by name, and deleted ones are skipped', async () => {
    const entry = await api.planting({ label: 'Quillfruit row' });
    const gone = await api.planting({ label: 'Quillfruit gone' });
    await t.call('DELETE', `/api/plantings/${gone.id}`);
    expect(await pick('planting', 'quill')).toEqual([
      { kind: 'planting', id: entry.id, label: 'Quillfruit row', detail: null },
    ]);
  });

  it('survives query punctuation', async () => {
    await api.note({ body: 'plain' });
    for (const q of ['"', '*', 'a AND', '(', "o'brien", '-x']) {
      expect(
        (await t.call('GET', `/api/pick?kind=note&q=${encodeURIComponent(q)}`)).status,
        q,
      ).toBe(200);
    }
  });
});

describe('any (the link picker)', () => {
  it('mixes people, notes and farm entries, each labelled with its kind', async () => {
    await api.person({ name: 'Lantern Keeper' });
    await api.note({ title: 'Lantern note', body: 'x' });
    await api.planting({ label: 'Lantern bed' });
    const items = await pick('any', 'lantern');
    expect(items.map((i) => i.kind).sort()).toEqual(['note', 'person', 'planting']);
  });

  it('respects the limit and the exclusion list', async () => {
    for (let i = 0; i < 5; i++) {
      await api.person({ name: `Item ${i}` });
      await api.note({ title: `Item note ${i}`, body: 'x' });
    }
    expect(await pick('any', 'item', '&limit=4')).toHaveLength(4);
    const all = await pick('any', 'item', '&limit=50');
    const ids = all
      .slice(0, 3)
      .map((i) => i.id)
      .join(',');
    const rest = await pick('any', 'item', `&limit=50&exclude=${ids}`);
    expect(rest).toHaveLength(all.length - 3);
  });
});
