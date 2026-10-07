import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Note, Page, Person } from '@shared/types';
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

const list = async (query = '') =>
  api.json<Page<Person>>(await t.call('GET', `/api/people${query}`));
const patch = (id: string, body: Record<string, unknown>) =>
  t.call('PATCH', `/api/people/${id}`, body);

describe('create', () => {
  it('a name is enough, and a fresh journal has no one', async () => {
    expect((await list()).items).toEqual([]);
    const person = await api.person({ name: 'Example Person' });
    expect(person).toMatchObject({
      name: 'Example Person',
      notes: '',
      progress: null,
      progressMax: null,
      customFields: [],
      tags: [],
    });
    expect((await list()).items.map((p) => p.id)).toEqual([person.id]);
  });

  it('is idempotent by id', async () => {
    const id = newId();
    await api.person({ id, name: 'Once' });
    const again = await api.json<Person>(
      await t.call('POST', '/api/people', { id, name: 'Twice' }),
      200,
    );
    expect(again.name).toBe('Once');
    expect((await list()).items).toHaveLength(1);
  });

  it('allows duplicate names', async () => {
    await api.person({ name: 'Same' });
    await api.person({ name: 'Same' });
    expect((await list()).items).toHaveLength(2);
  });

  it('requires a trimmed name of 1 to 80 characters', async () => {
    for (const name of ['', '   ']) {
      const error = await api.error(await t.call('POST', '/api/people', { name }), 400);
      expect(error.message).toBe('Add a name.');
    }
    expect((await api.person({ name: '  Padded  ' })).name).toBe('Padded');
    expect((await api.person({ name: 'x'.repeat(80) })).name).toHaveLength(80);
    await api.error(await t.call('POST', '/api/people', { name: 'x'.repeat(81) }), 400);
    await api.error(await t.call('POST', '/api/people', {}), 400);
  });

  it('limits notes to 20,000 characters, with the count in the message', async () => {
    const error = await api.error(
      await t.call('POST', '/api/people', { name: 'A', notes: 'x'.repeat(20_001) }),
      400,
    );
    expect(error.message).toBe('Too long: 20,001 of 20,000 characters.');
  });
});

describe('progress', () => {
  it('the maximum is the user’s own number from 1 to 99, and progress stays within it', async () => {
    const person = await api.person({ name: 'A', progressMax: 5, progress: 3 });
    expect(person).toMatchObject({ progress: 3, progressMax: 5 });
    expect((await patch(person.id, { progress: 0 })).status).toBe(200);
    expect((await patch(person.id, { progress: 5 })).status).toBe(200);
    const high = await api.error(await patch(person.id, { progress: 6 }), 400);
    expect(high.message).toBe("Progress can't be higher than the maximum.");
    await api.error(await patch(person.id, { progress: -1 }), 400);
    await api.error(await patch(person.id, { progressMax: 100 }), 400);
    await api.error(await patch(person.id, { progressMax: 0 }), 400);
  });

  it('progress cannot exist without a maximum, and clearing both works', async () => {
    await api.error(await t.call('POST', '/api/people', { name: 'A', progress: 1 }), 400);
    const person = await api.person({ name: 'A', progressMax: 4, progress: 2 });
    await api.error(await patch(person.id, { progressMax: null }), 400);
    const cleared = await api.json<Person>(
      await patch(person.id, { progress: null, progressMax: null }),
    );
    expect(cleared).toMatchObject({ progress: null, progressMax: null });
  });

  it('lowering the maximum below the current value is refused (the client asks to clamp)', async () => {
    const person = await api.person({ name: 'A', progressMax: 9, progress: 7 });
    await api.error(await patch(person.id, { progressMax: 5 }), 400);
    const ok = await api.json<Person>(await patch(person.id, { progressMax: 5, progress: 5 }));
    expect(ok).toMatchObject({ progress: 5, progressMax: 5 });
  });
});

describe('custom fields', () => {
  it('stores label and value rows, replaced as a whole', async () => {
    const person = await api.person({
      name: 'A',
      customFields: [{ label: 'Label', value: 'Value' }],
    });
    expect(person.customFields).toEqual([{ label: 'Label', value: 'Value' }]);
    const next = await api.json<Person>(
      await patch(person.id, { customFields: [{ label: 'Other', value: '' }] }),
    );
    expect(next.customFields).toEqual([{ label: 'Other', value: '' }]);
    expect(
      (await api.json<Person>(await patch(person.id, { customFields: [] }))).customFields,
    ).toEqual([]);
  });

  it('labels are unique ignoring case, 1 to 40 characters; values up to 500; at most 30 fields', async () => {
    const dup = await api.error(
      await t.call('POST', '/api/people', {
        name: 'A',
        customFields: [
          { label: 'X', value: '' },
          { label: 'x', value: '' },
        ],
      }),
      400,
    );
    expect(dup.message).toBe('That label is already used here.');
    await api.error(
      await t.call('POST', '/api/people', { name: 'A', customFields: [{ label: '', value: '' }] }),
      400,
    );
    await api.error(
      await t.call('POST', '/api/people', {
        name: 'A',
        customFields: [{ label: 'x'.repeat(41), value: '' }],
      }),
      400,
    );
    await api.error(
      await t.call('POST', '/api/people', {
        name: 'A',
        customFields: [{ label: 'a', value: 'x'.repeat(501) }],
      }),
      400,
    );
    const thirty = Array.from({ length: 30 }, (_, i) => ({ label: `f${i}`, value: '' }));
    expect((await api.person({ name: 'A', customFields: thirty })).customFields).toHaveLength(30);
    await api.error(
      await t.call('POST', '/api/people', {
        name: 'A',
        customFields: [...thirty, { label: 'extra', value: '' }],
      }),
      400,
    );
  });

  it('labels already used on other people autocomplete', async () => {
    await api.person({
      name: 'A',
      customFields: [
        { label: 'Favourite thing', value: 'x' },
        { label: 'Other', value: '' },
      ],
    });
    await api.person({ name: 'B', customFields: [{ label: 'favourite thing', value: 'y' }] });
    const labels = async (q: string) =>
      (
        await api.json<{ labels: string[] }>(
          await t.call('GET', `/api/field-labels?kind=person&q=${encodeURIComponent(q)}`),
        )
      ).labels;
    expect((await labels('fav')).map((l) => l.toLowerCase())).toEqual(['favourite thing']);
    expect(await labels('o')).toEqual(['Other']);
    expect((await labels('')).length).toBe(3 - 1);
    expect(await labels('zzz')).toEqual([]);
    expect(await labels('%')).toEqual([]);
  });

  it('does not offer labels from deleted people', async () => {
    const person = await api.person({ name: 'A', customFields: [{ label: 'Gone', value: '' }] });
    await t.call('DELETE', `/api/people/${person.id}`);
    const res = await api.json<{ labels: string[] }>(
      await t.call('GET', '/api/field-labels?kind=person&q=g'),
    );
    expect(res.labels).toEqual([]);
  });
});

describe('update', () => {
  it('is partial, and the notes field autosaves as a whole', async () => {
    const person = await api.person({ name: 'A', notes: 'one' });
    api.tick();
    const next = await api.json<Person>(await patch(person.id, { notes: 'two' }));
    expect(next).toMatchObject({ name: 'A', notes: 'two' });
    expect(Date.parse(next.updatedAt)).toBeGreaterThan(Date.parse(person.updatedAt));
    expect(next.createdAt).toBe(person.createdAt);
  });

  it('returns 409 with the current record for a stale edit', async () => {
    const person = await api.person({ name: 'A' });
    await patch(person.id, { name: 'B' });
    const error = await api.error(
      await patch(person.id, { name: 'C', expectedUpdatedAt: person.updatedAt }),
      409,
    );
    expect(error.code).toBe('conflict');
    expect((error.details?.current as Person).name).toBe('B');
  });

  it('replaces tags, shared with notes', async () => {
    const person = await api.person({ name: 'A', tags: ['Idea'] });
    await api.note({ body: 'x', tags: ['idea'] });
    expect(person.tags).toEqual(['Idea']);
    expect((await api.json<Person>(await patch(person.id, { tags: ['other'] }))).tags).toEqual([
      'other',
    ]);
    expect((await api.tags()).map((tag) => tag.name).sort()).toEqual(['Idea', 'other']);
  });
});

describe('list', () => {
  it('sorts A to Z ignoring case, or by recent update', async () => {
    const b = await api.person({ name: 'bob' });
    const a = await api.person({ name: 'Alice' });
    const c = await api.person({ name: 'Carol' });
    expect((await list()).items.map((p) => p.name)).toEqual(['Alice', 'bob', 'Carol']);
    api.tick();
    await patch(b.id, { notes: 'touched' });
    expect((await list('?sort=updated')).items.map((p) => p.id)).toEqual([b.id, c.id, a.id]);
  });

  it('filters by tag and pages with a cursor', async () => {
    for (let i = 0; i < 5; i++)
      await api.person({ name: `P${i}`, tags: i % 2 === 0 ? ['even'] : [] });
    expect((await list('?tag=EVEN')).items.map((p) => p.name)).toEqual(['P0', 'P2', 'P4']);
    const first = await list('?limit=2');
    expect(first.items.map((p) => p.name)).toEqual(['P0', 'P1']);
    const second = await list(`?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((p) => p.name)).toEqual(['P2', 'P3']);
    const third = await list(`?limit=2&cursor=${second.nextCursor}`);
    expect(third.items.map((p) => p.name)).toEqual(['P4']);
    expect(third.nextCursor).toBeNull();
  });
});

describe('list limits', () => {
  it('accepts up to 500 (the web app asks for 500) and rejects more', async () => {
    await api.person({ name: 'A' });
    expect((await list('?limit=500')).items).toHaveLength(1);
    expect((await api.error(await t.call('GET', '/api/people?limit=501'), 400)).code).toBe(
      'validation_failed',
    );
    expect((await api.error(await t.call('GET', '/api/people?limit=0'), 400)).code).toBe(
      'validation_failed',
    );
  });
});

describe('delete, restore and backlinks', () => {
  it('"Notes about" lists linking notes, newest first, without deleted ones', async () => {
    const person = await api.person({ name: 'Example Person' });
    const a = await api.note({ body: 'older', links: [{ type: 'person', id: person.id }] });
    const b = await api.note({ body: 'newer', links: [{ type: 'person', id: person.id }] });
    await api.note({ body: 'unrelated' });
    const notes = await api.json<Page<Note>>(await t.call('GET', `/api/people/${person.id}/notes`));
    expect(notes.items.map((n) => n.id)).toEqual([b.id, a.id]);
    await t.call('DELETE', `/api/notes/${b.id}`);
    const after = await api.json<Page<Note>>(await t.call('GET', `/api/people/${person.id}/notes`));
    expect(after.items.map((n) => n.id)).toEqual([a.id]);
  });

  it('delete then undo restores the person and their note links', async () => {
    const person = await api.person({ name: 'Example Person', tags: ['idea'] });
    const note = await api.note({ body: 'about them', links: [{ type: 'person', id: person.id }] });
    expect((await t.call('DELETE', `/api/people/${person.id}`)).status).toBe(204);
    expect((await list()).items).toEqual([]);
    await api.error(await t.call('GET', `/api/people/${person.id}`), 404);
    await api.error(await t.call('GET', `/api/people/${person.id}/notes`), 404);
    expect((await api.getNote(note.id)).links).toEqual([]);
    const restored = await api.json<Person>(
      await t.call('POST', `/api/people/${person.id}/restore`),
    );
    expect(restored.tags).toEqual(['idea']);
    expect((await api.getNote(note.id)).links.map((l) => l.id)).toEqual([person.id]);
    expect((await list()).items).toHaveLength(1);
  });

  it('a deleted person is excluded from tag counts', async () => {
    const person = await api.person({ name: 'A', tags: ['idea'] });
    await t.call('DELETE', `/api/people/${person.id}`);
    expect((await api.tags())[0]?.counts).toEqual({ notes: 0, people: 0, plantings: 0 });
    await t.call('POST', `/api/people/${person.id}/restore`);
    expect((await api.tags())[0]?.counts.people).toBe(1);
  });

  it('404s for unknown ids and 400 for malformed ones', async () => {
    await api.error(await t.call('GET', `/api/people/${newId()}`), 404);
    await api.error(await patch(newId(), { name: 'x' }), 404);
    await api.error(await t.call('DELETE', `/api/people/${newId()}`), 404);
    await api.error(await t.call('GET', '/api/people/bad'), 400);
  });
});
