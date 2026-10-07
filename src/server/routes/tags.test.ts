import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tag } from '@shared/types';
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

const patch = (id: string, body: Record<string, unknown>) =>
  t.call('PATCH', `/api/tags/${id}`, body);
const find = async (name: string) => (await api.tags()).find((tag) => tag.name === name)!;
const ftsTags = (kind: string, id: string) =>
  (
    t.database.sqlite
      .prepare('SELECT tags FROM search_fts WHERE kind = ? AND ref_id = ?')
      .get(kind, id) as { tags: string }
  ).tags;

describe('list and create', () => {
  it('a fresh journal has no tags', async () => {
    expect(await api.tags()).toEqual([]);
  });

  it('counts live records of each kind, pinned first then by name', async () => {
    const person = await api.person({ name: 'P', tags: ['beta'] });
    await api.planting({ label: 'E', tags: ['beta', 'alpha'] });
    const note = await api.note({ body: 'x', tags: ['beta'] });
    await api.note({ body: 'y', tags: ['Zed'] });
    const tags = await api.tags();
    expect(tags.map((tag) => tag.name)).toEqual(['alpha', 'beta', 'Zed']);
    expect(tags.find((x) => x.name === 'beta')?.counts).toEqual({
      notes: 1,
      people: 1,
      plantings: 1,
    });
    await patch((await find('Zed')).id, { pinned: true });
    expect((await api.tags()).map((x) => x.name)).toEqual(['Zed', 'alpha', 'beta']);
    await t.call('DELETE', `/api/notes/${note.id}`);
    await t.call('DELETE', `/api/people/${person.id}`);
    expect((await find('beta')).counts).toEqual({ notes: 0, people: 0, plantings: 1 });
  });

  it('POST returns the existing tag when the key matches, and creates a new one otherwise', async () => {
    const a = await api.json<Tag>(await t.call('POST', '/api/tags', { name: 'Idea' }));
    const b = await api.json<Tag>(await t.call('POST', '/api/tags', { name: '#idea' }));
    expect(b.id).toBe(a.id);
    expect(b.name).toBe('Idea');
    expect(await api.tags()).toHaveLength(1);
  });

  it('rejects invalid names', async () => {
    for (const name of ['', '!!', 'a,b', 'x'.repeat(41)]) {
      expect((await api.error(await t.call('POST', '/api/tags', { name }), 400)).code, name).toBe(
        'validation_failed',
      );
    }
  });
});

describe('rename and pin', () => {
  it('AC-TAG-2: renaming updates every note, person and farm entry, and the search index', async () => {
    const note = await api.note({ body: 'x', tags: ['idea'] });
    const person = await api.person({ name: 'P', tags: ['idea'] });
    const entry = await api.planting({ label: 'E', tags: ['idea'] });
    const tag = await find('idea');
    const renamed = await api.json<Tag>(await patch(tag.id, { name: 'Better' }));
    expect(renamed.name).toBe('Better');
    expect((await api.getNote(note.id)).tags).toEqual(['Better']);
    expect(
      (await api.json<{ tags: string[] }>(await t.call('GET', `/api/people/${person.id}`))).tags,
    ).toEqual(['Better']);
    expect(
      (await api.json<{ tags: string[] }>(await t.call('GET', `/api/plantings/${entry.id}`))).tags,
    ).toEqual(['Better']);
    expect(ftsTags('note', note.id)).toBe('Better');
    expect(ftsTags('person', person.id)).toBe('Better');
    expect(ftsTags('planting', entry.id)).toBe('Better');
  });

  it('changing only the casing is a rename, not a collision', async () => {
    await api.note({ body: 'x', tags: ['idea'] });
    const tag = await find('idea');
    expect((await api.json<Tag>(await patch(tag.id, { name: 'IDEA' }))).name).toBe('IDEA');
  });

  it('a name that matches another tag is a 409 with existingId, and nothing changes', async () => {
    await api.note({ body: 'x', tags: ['one', 'two'] });
    const one = await find('one');
    const two = await find('two');
    const error = await api.error(await patch(one.id, { name: 'Two' }), 409);
    expect(error.code).toBe('conflict');
    expect(error.details).toMatchObject({ existingId: two.id });
    expect(error.message).toBe('Merge into #two?');
    expect((await api.tags()).map((x) => x.name)).toEqual(['one', 'two']);
  });

  it('AC-TAG-5: pin and unpin', async () => {
    await api.note({ body: 'x', tags: ['a', 'b'] });
    const b = await find('b');
    expect((await api.json<Tag>(await patch(b.id, { pinned: true }))).pinned).toBe(true);
    expect((await api.tags())[0]?.name).toBe('b');
    expect((await api.json<Tag>(await patch(b.id, { pinned: false }))).pinned).toBe(false);
  });

  it('validates the new name and 404s for a missing tag', async () => {
    await api.note({ body: 'x', tags: ['a'] });
    await api.error(await patch((await find('a')).id, { name: '###' }), 400);
    await api.error(await patch(newId(), { pinned: true }), 404);
  });
});

describe('merge', () => {
  it('AC-TAG-3: yields the union of records with no duplicate associations', async () => {
    const both = await api.note({ body: 'both', tags: ['src', 'dst'] });
    const onlySrc = await api.note({ body: 'src only', tags: ['src'] });
    const onlyDst = await api.note({ body: 'dst only', tags: ['dst'] });
    const person = await api.person({ name: 'P', tags: ['src'] });
    const src = await find('src');
    const dst = await find('dst');
    const merged = await api.json<Tag>(
      await t.call('POST', `/api/tags/${src.id}/merge`, { intoId: dst.id }),
    );
    expect(merged.counts).toEqual({ notes: 3, people: 1, plantings: 0 });
    expect(await api.tags()).toHaveLength(1);
    for (const n of [both, onlySrc, onlyDst])
      expect((await api.getNote(n.id)).tags).toEqual(['dst']);
    expect(ftsTags('person', person.id)).toBe('dst');
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM note_tags').get()).toEqual({
      n: 3,
    });
  });

  it('refuses to merge a tag into itself or a missing tag', async () => {
    await api.note({ body: 'x', tags: ['a'] });
    const a = await find('a');
    await api.error(await t.call('POST', `/api/tags/${a.id}/merge`, { intoId: a.id }), 400);
    await api.error(await t.call('POST', `/api/tags/${a.id}/merge`, { intoId: newId() }), 404);
    expect(await api.tags()).toHaveLength(1);
  });
});

describe('delete', () => {
  it('AC-TAG-4: removes only the join rows and leaves every record intact', async () => {
    const note = await api.note({ body: 'keep', tags: ['gone'] });
    const person = await api.person({ name: 'P', tags: ['gone'] });
    const tag = await find('gone');
    expect((await t.call('DELETE', `/api/tags/${tag.id}`)).status).toBe(204);
    expect(await api.tags()).toEqual([]);
    expect((await api.getNote(note.id)).tags).toEqual([]);
    expect(ftsTags('note', note.id)).toBe('');
    expect(ftsTags('person', person.id)).toBe('');
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM notes').get()).toEqual({ n: 1 });
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM people').get()).toEqual({ n: 1 });
    await api.error(await t.call('DELETE', `/api/tags/${tag.id}`), 404);
  });
});
