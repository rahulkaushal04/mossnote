import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encode } from '@shared/gameDate';
import type { Note } from '@shared/types';
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

describe('create (POST /api/notes)', () => {
  it('a body alone is enough, and nothing else is required', async () => {
    const note = await api.note({ body: 'x' });
    expect(note).toMatchObject({
      title: null,
      body: 'x',
      gameDate: null,
      isDiscovery: false,
      question: null,
      tags: [],
      links: [],
    });
    expect(note.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(note.createdAt).toBe(note.updatedAt);
  });

  it('stores the game date the client sends, and none otherwise', async () => {
    expect((await api.note({ body: 'a', gameDate: k(1, 0, 3) })).gameDate).toBe(10_003);
    expect((await api.note({ body: 'b' })).gameDate).toBeNull();
  });

  it('is idempotent: repeating a POST with the same id returns the existing note with 200', async () => {
    const id = newId();
    const first = await api.note({ id, body: 'once' });
    const again = await api.json<Note>(
      await t.call('POST', '/api/notes', { id, body: 'twice' }),
      200,
    );
    expect(again.id).toBe(first.id);
    expect(again.body).toBe('once');
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM notes').get()).toEqual({ n: 1 });
  });

  it('refuses whitespace-only content, title or body', async () => {
    for (const body of [{ body: '   ' }, { body: '' }, {}, { title: '  ', body: '\n\t' }]) {
      const error = await api.error(await t.call('POST', '/api/notes', body), 400);
      expect(error.code).toBe('validation_failed');
      expect(error.message).toBe('Write something first.');
    }
    expect((await api.notes()).items).toEqual([]);
  });

  it('accepts a title with no body, and stores a blank title as null', async () => {
    expect((await api.note({ title: 'Only a title' })).title).toBe('Only a title');
    expect((await api.note({ title: '   ', body: 'text' })).title).toBeNull();
    expect((await api.note({ title: '  padded  ', body: 'text' })).title).toBe('padded');
  });

  it('enforces length limits with the counts in the message', async () => {
    const tooLong = await api.error(
      await t.call('POST', '/api/notes', { body: 'x'.repeat(50_001) }),
      400,
    );
    expect(tooLong.message).toBe('Too long: 50,001 of 50,000 characters.');
    expect(tooLong.fields).toHaveProperty('body');
    expect((await api.note({ body: 'x'.repeat(50_000) })).body).toHaveLength(50_000);
    const title = await api.error(
      await t.call('POST', '/api/notes', { title: 'x'.repeat(201), body: 'a' }),
      400,
    );
    expect(title.message).toBe('Titles can be up to 200 characters.');
  });

  it('normalises CRLF to LF and removes NUL, and nothing else', async () => {
    const note = await api.note({ body: 'a\r\nb\0c <b>kept</b> &amp;' });
    expect(note.body).toBe('ab\nc <b>kept</b> &amp;'.replace('ab\n', 'a\nb'));
  });

  it('rejects dates outside the calendar and unknown fields', async () => {
    for (const gameDate of [k(1, 0, 29), k(1, 4, 1), k(0, 0, 1), 5]) {
      const error = await api.error(
        await t.call('POST', '/api/notes', { body: 'x', gameDate }),
        400,
      );
      expect(error.message).toBe("That date isn't in your calendar.");
      expect(error.fields).toEqual({ gameDate: "That date isn't in your calendar." });
    }
    const unknown = await api.error(
      await t.call('POST', '/api/notes', { body: 'x', color: 'red' }),
      400,
    );
    expect(unknown.code).toBe('validation_failed');
  });

  it('rejects an id that is not a ULID', async () => {
    const error = await api.error(
      await t.call('POST', '/api/notes', { id: 'abc', body: 'x' }),
      400,
    );
    expect(error.code).toBe('validation_failed');
  });
});

describe('tags on notes', () => {
  it('#Idea and #idea are one tag, shown with the first-used casing', async () => {
    const a = await api.note({ body: 'a', tags: ['Idea'] });
    const b = await api.note({ body: 'b', tags: ['#idea'] });
    expect(a.tags).toEqual(['Idea']);
    expect(b.tags).toEqual(['Idea']);
    expect(await api.tags()).toHaveLength(1);
  });

  it('collapses duplicates, sorts alphabetically, and creates tags on use', async () => {
    const note = await api.note({ body: 'a', tags: ['zeta', 'Alpha', 'alpha', 'two words'] });
    expect(note.tags).toEqual(['Alpha', 'two-words', 'zeta']);
  });

  it('rejects an invalid tag by index, and more than 30', async () => {
    const bad = await api.error(
      await t.call('POST', '/api/notes', { body: 'x', tags: ['ok', '!!'] }),
      400,
    );
    expect(bad.fields).toEqual({ 'tags.1': 'Tags need at least one letter or number.' });
    const many = await api.error(
      await t.call('POST', '/api/notes', {
        body: 'x',
        tags: Array.from({ length: 31 }, (_, i) => `t${i}`),
      }),
      400,
    );
    expect(many.message).toBe('A note can have up to 30 tags.');
    expect((await api.tags()).length).toBe(0);
  });
});

describe('links on notes', () => {
  it('stores person, farm entry and note links with labels', async () => {
    const person = await api.person({ name: 'Example Person' });
    const entry = await api.planting({ label: 'Example entry' });
    const target = await api.note({ title: 'Target note', body: 'x' });
    const longBody = 'An untitled target note with a rather long first line that goes on and on';
    const untitled = await api.note({ body: longBody });
    const note = await api.note({
      body: 'hi',
      links: [
        { type: 'person', id: person.id },
        { type: 'planting', id: entry.id },
        { type: 'note', id: target.id },
        { type: 'note', id: untitled.id },
      ],
    });
    expect(note.links.map((l) => `${l.type}:${l.label}`).sort()).toEqual([
      `note:${longBody.slice(0, 60)}…`,
      'note:Target note',
      'person:Example Person',
      'planting:Example entry',
    ]);
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM links').get()).toEqual({ n: 4 });
  });

  it('refuses a self link, a missing target, and an over-long list', async () => {
    const note = await api.note({ body: 'x' });
    for (const links of [
      [{ type: 'note', id: note.id }],
      [{ type: 'person', id: newId() }],
      [{ type: 'note', id: newId() }],
    ]) {
      const error = await api.error(await t.call('PATCH', `/api/notes/${note.id}`, { links }), 400);
      expect(error.message).toBe("That link can't be added.");
    }
    const many = Array.from({ length: 51 }, () => ({ type: 'note', id: newId() }));
    await api.error(await t.call('PATCH', `/api/notes/${note.id}`, { links: many }), 400);
  });

  it('ignores duplicate links, and patching links replaces the whole set', async () => {
    const p1 = await api.person({ name: 'One' });
    const p2 = await api.person({ name: 'Two' });
    const note = await api.note({
      body: 'x',
      links: [
        { type: 'person', id: p1.id },
        { type: 'person', id: p1.id },
      ],
    });
    expect(note.links).toHaveLength(1);
    const swapped = await api.patchNote(note.id, { links: [{ type: 'person', id: p2.id }] });
    expect(swapped.links.map((l) => l.label)).toEqual(['Two']);
    expect((await api.patchNote(note.id, { links: [] })).links).toEqual([]);
  });

  it('renaming a person changes the label on every chip', async () => {
    const person = await api.person({ name: 'Old Name' });
    const n1 = await api.note({ body: 'a', links: [{ type: 'person', id: person.id }] });
    const n2 = await api.note({ body: 'b', links: [{ type: 'person', id: person.id }] });
    await api.t.call('PATCH', `/api/people/${person.id}`, { name: 'New Name' });
    for (const n of [n1, n2]) expect((await api.getNote(n.id)).links[0]?.label).toBe('New Name');
  });

  it('deleting a person hides chips; undo restores them', async () => {
    const person = await api.person({ name: 'Example Person' });
    const note = await api.note({ body: 'a', links: [{ type: 'person', id: person.id }] });
    await t.call('DELETE', `/api/people/${person.id}`);
    expect((await api.getNote(note.id)).links).toEqual([]);
    await t.call('POST', `/api/people/${person.id}/restore`);
    expect((await api.getNote(note.id)).links).toHaveLength(1);
  });

  it('shows "Linked from" on a note, newest first, without deleted notes', async () => {
    const target = await api.note({ body: 'target' });
    const a = await api.note({ body: 'older', links: [{ type: 'note', id: target.id }] });
    const b = await api.note({ body: 'newer', links: [{ type: 'note', id: target.id }] });
    expect((await api.getNote(target.id)).linkedFrom.map((l) => l.id)).toEqual([b.id, a.id]);
    await t.call('DELETE', `/api/notes/${b.id}`);
    expect((await api.getNote(target.id)).linkedFrom.map((l) => l.id)).toEqual([a.id]);
  });
});

describe('read (GET /api/notes/:id)', () => {
  it('returns 404 for a missing or deleted note and 400 for a bad id', async () => {
    expect((await api.error(await t.call('GET', `/api/notes/${newId()}`), 404)).code).toBe(
      'not_found',
    );
    const note = await api.note({ body: 'x' });
    await t.call('DELETE', `/api/notes/${note.id}`);
    await api.error(await t.call('GET', `/api/notes/${note.id}`), 404);
    expect((await api.error(await t.call('GET', '/api/notes/nope'), 400)).code).toBe(
      'validation_failed',
    );
  });
});

describe('update (PATCH /api/notes/:id)', () => {
  it('updatedAt advances, createdAt never changes', async () => {
    const note = await api.note({ body: 'before' });
    const after = await api.patchNote(note.id, { body: 'after' });
    expect(after.body).toBe('after');
    expect(after.createdAt).toBe(note.createdAt);
    expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(note.updatedAt));
  });

  it('updatedAt advances even when two saves land in the same millisecond', async () => {
    const note = await api.note({ body: 'a' });
    const one = await api.json<Note>(await t.call('PATCH', `/api/notes/${note.id}`, { body: 'b' }));
    const two = await api.json<Note>(await t.call('PATCH', `/api/notes/${note.id}`, { body: 'c' }));
    expect(Date.parse(two.updatedAt)).toBeGreaterThan(Date.parse(one.updatedAt));
  });

  it('an absent field is unchanged and null clears a nullable one', async () => {
    const note = await api.note({ title: 'T', body: 'B', gameDate: k(1, 1, 5), isDiscovery: true });
    const same = await api.patchNote(note.id, { body: 'B2' });
    expect(same).toMatchObject({ title: 'T', gameDate: k(1, 1, 5), isDiscovery: true });
    const cleared = await api.patchNote(note.id, { title: null, gameDate: null });
    expect(cleared).toMatchObject({ title: null, gameDate: null, body: 'B2' });
  });

  it('emptying both title and body is refused and leaves the note unchanged', async () => {
    const note = await api.note({ title: 'T', body: 'B' });
    const error = await api.error(
      await t.call('PATCH', `/api/notes/${note.id}`, { title: null, body: '  ' }),
      400,
    );
    expect(error.message).toBe('Write something first.');
    expect(await api.getNote(note.id)).toMatchObject({ title: 'T', body: 'B' });
  });

  it('a stale edit returns 409 with the current note and changes nothing', async () => {
    const note = await api.note({ body: 'v1' });
    const newer = await api.patchNote(note.id, { body: 'v2' });
    const error = await api.error(
      await t.call('PATCH', `/api/notes/${note.id}`, {
        body: 'mine',
        expectedUpdatedAt: note.updatedAt,
      }),
      409,
    );
    expect(error.code).toBe('conflict');
    expect((error.details?.current as Note).body).toBe('v2');
    expect((await api.getNote(note.id)).body).toBe('v2');
    const ok = await api.json<Note>(
      await t.call('PATCH', `/api/notes/${note.id}`, {
        body: 'mine',
        expectedUpdatedAt: newer.updatedAt,
      }),
    );
    expect(ok.body).toBe('mine');
  });

  it('replaces tags as a set', async () => {
    const note = await api.note({ body: 'x', tags: ['a', 'b'] });
    expect((await api.patchNote(note.id, { tags: ['b', 'c'] })).tags).toEqual(['b', 'c']);
    expect((await api.patchNote(note.id, { tags: [] })).tags).toEqual([]);
    expect((await api.tags()).map((tag) => tag.name)).toEqual(['a', 'b', 'c']);
  });

  it('validates the new date, and 404s for a missing note', async () => {
    const note = await api.note({ body: 'x' });
    await api.error(await t.call('PATCH', `/api/notes/${note.id}`, { gameDate: k(1, 9, 1) }), 400);
    await api.error(await t.call('PATCH', `/api/notes/${newId()}`, { body: 'x' }), 404);
  });
});

describe('questions and discoveries', () => {
  it('the discovery flag persists and toggles', async () => {
    const note = await api.note({ body: 'x' });
    expect((await api.patchNote(note.id, { isDiscovery: true })).isDiscovery).toBe(true);
    expect((await api.getNote(note.id)).isDiscovery).toBe(true);
    expect((await api.patchNote(note.id, { isDiscovery: false })).isDiscovery).toBe(false);
  });

  it('a note can be both a question and a discovery', async () => {
    const note = await api.note({ body: 'x', isDiscovery: true, question: { state: 'open' } });
    expect(note).toMatchObject({ isDiscovery: true, question: { state: 'open' } });
  });

  it('solving stores the resolution, the solved date (default: the current date) and time', async () => {
    await t.call('PATCH', '/api/settings', { currentGameDate: k(1, 2, 9) });
    const note = await api.note({ body: 'why?', question: { state: 'open' } });
    const solved = await api.patchNote(note.id, {
      question: { state: 'solved', resolution: 'Because.' },
    });
    expect(solved.question).toEqual({
      state: 'solved',
      resolution: 'Because.',
      solvedGameDate: k(1, 2, 9),
      solvedAt: expect.any(String) as string,
    });
  });

  it('solving without an answer is allowed, and an explicit solved date wins', async () => {
    const note = await api.note({ body: 'why?', question: { state: 'open' } });
    const solved = await api.patchNote(note.id, {
      question: { state: 'solved', solvedGameDate: k(2, 0, 1) },
    });
    expect(solved.question).toMatchObject({
      state: 'solved',
      resolution: null,
      solvedGameDate: k(2, 0, 1),
    });
  });

  it('reopening keeps the resolution text and clears the solved fields', async () => {
    const note = await api.note({ body: 'why?', question: { state: 'open' } });
    await api.patchNote(note.id, { question: { state: 'solved', resolution: 'Because.' } });
    const reopened = await api.patchNote(note.id, { question: { state: 'open' } });
    expect(reopened.question).toEqual({
      state: 'open',
      resolution: 'Because.',
      solvedGameDate: null,
      solvedAt: null,
    });
    const replaced = await api.patchNote(note.id, {
      question: { state: 'solved', resolution: 'Better.' },
    });
    expect(replaced.question?.resolution).toBe('Better.');
  });

  it('editing the answer of a solved question keeps the original solved time', async () => {
    const note = await api.note({ body: 'why?', question: { state: 'open' } });
    const solved = await api.patchNote(note.id, { question: { state: 'solved', resolution: 'a' } });
    api.tick(60_000);
    const edited = await api.patchNote(note.id, { question: { state: 'solved', resolution: 'b' } });
    expect(edited.question?.solvedAt).toBe(solved.question?.solvedAt);
  });

  it('removing the question clears every question field', async () => {
    const note = await api.note({ body: 'x', question: { state: 'open', resolution: 'draft' } });
    expect((await api.patchNote(note.id, { question: null })).question).toBeNull();
    const row = t.database.sqlite
      .prepare('SELECT * FROM notes WHERE id = ?')
      .get(note.id) as Record<string, unknown>;
    expect([row.question_state, row.resolution, row.solved_at, row.solved_game_date]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('limits the answer to 2,000 characters and validates the solved date', async () => {
    const note = await api.note({ body: 'x', question: { state: 'open' } });
    const long = await api.error(
      await t.call('PATCH', `/api/notes/${note.id}`, {
        question: { state: 'solved', resolution: 'x'.repeat(2001) },
      }),
      400,
    );
    expect(long.message).toBe('Answers can be up to 2,000 characters.');
    await api.error(
      await t.call('PATCH', `/api/notes/${note.id}`, {
        question: { state: 'solved', solvedGameDate: k(1, 0, 40) },
      }),
      400,
    );
  });
});

describe('delete and restore', () => {
  it('delete is soft, hidden from lists, and undo restores tags and links', async () => {
    const person = await api.person({ name: 'Example Person' });
    const note = await api.note({
      body: 'keep me',
      tags: ['idea'],
      links: [{ type: 'person', id: person.id }],
    });
    expect((await t.call('DELETE', `/api/notes/${note.id}`)).status).toBe(204);
    expect((await api.notes()).items).toEqual([]);
    const restored = await api.json<Note>(await t.call('POST', `/api/notes/${note.id}/restore`));
    expect(restored.tags).toEqual(['idea']);
    expect(restored.links.map((l) => l.id)).toEqual([person.id]);
    expect((await api.notes()).items.map((n) => n.id)).toEqual([note.id]);
  });

  it('deleting twice is fine; restoring a live note returns it; unknown ids are 404', async () => {
    const note = await api.note({ body: 'x' });
    expect((await t.call('DELETE', `/api/notes/${note.id}`)).status).toBe(204);
    expect((await t.call('DELETE', `/api/notes/${note.id}`)).status).toBe(204);
    await api.json<Note>(await t.call('POST', `/api/notes/${note.id}/restore`));
    await api.json<Note>(await t.call('POST', `/api/notes/${note.id}/restore`));
    await api.error(await t.call('DELETE', `/api/notes/${newId()}`), 404);
    await api.error(await t.call('POST', `/api/notes/${newId()}/restore`), 404);
  });

  it('a deleted note cannot be patched', async () => {
    const note = await api.note({ body: 'x' });
    await t.call('DELETE', `/api/notes/${note.id}`);
    await api.error(await t.call('PATCH', `/api/notes/${note.id}`, { body: 'y' }), 404);
  });
});

describe('list and filters (GET /api/notes)', () => {
  async function seed() {
    const n = {
      a: await api.note({ body: 'a', gameDate: k(1, 0, 3), tags: ['idea'] }),
      b: await api.note({
        body: 'b',
        gameDate: k(1, 0, 3),
        isDiscovery: true,
        tags: ['idea', 'other'],
      }),
      c: await api.note({
        body: 'c',
        gameDate: k(1, 1, 1),
        question: { state: 'open' },
        tags: ['idea'],
      }),
      d: await api.note({
        body: 'd',
        gameDate: k(2, 0, 5),
        question: { state: 'open' },
        isDiscovery: true,
      }),
      u1: await api.note({ body: 'u1' }),
      u2: await api.note({ body: 'u2', question: { state: 'open' } }),
    };
    await api.patchNote(n.d.id, { question: { state: 'solved', resolution: 'done' } });
    return n;
  }
  const ids = (page: { items: Note[] }) => page.items.map((n) => n.body);

  it('newest first by game date, then creation time; undated last', async () => {
    await seed();
    expect(ids(await api.notes())).toEqual(['d', 'c', 'b', 'a', 'u2', 'u1']);
  });

  it('ascending reverses day order and order within a day; undated stay last', async () => {
    await seed();
    expect(ids(await api.notes('?order=asc'))).toEqual(['a', 'b', 'c', 'd', 'u1', 'u2']);
  });

  it('filters by flag, state and tag, and combines them with AND', async () => {
    await seed();
    expect(ids(await api.notes('?flag=discovery'))).toEqual(['d', 'b']);
    expect(ids(await api.notes('?flag=question'))).toEqual(['d', 'c', 'u2']);
    expect(ids(await api.notes('?flag=question&state=open'))).toEqual(['c', 'u2']);
    expect(ids(await api.notes('?state=solved'))).toEqual(['d']);
    expect(ids(await api.notes('?tag=idea'))).toEqual(['c', 'b', 'a']);
    expect(ids(await api.notes('?tag=IDEA&tag=other'))).toEqual(['b']);
    expect(ids(await api.notes('?tag=idea&flag=question&state=open'))).toEqual(['c']);
    expect(ids(await api.notes('?tag=missing'))).toEqual([]);
    expect(ids(await api.notes('?tag=!!'))).toEqual([]);
  });

  it('filters by exact date, range, undated, and creation time', async () => {
    const n = await seed();
    expect(ids(await api.notes(`?gameDate=${k(1, 0, 3)}`))).toEqual(['b', 'a']);
    expect(ids(await api.notes(`?from=${k(1, 1, 1)}&to=${k(1, 3, 28)}`))).toEqual(['c']);
    expect(ids(await api.notes('?undated=1'))).toEqual(['u2', 'u1']);
    expect(
      ids(
        await api.notes(
          `?createdFrom=${Date.parse(n.c.createdAt)}&createdTo=${Date.parse(n.d.createdAt)}`,
        ),
      ),
    ).toEqual(['d', 'c']);
  });

  it('filters by linked person or farm entry', async () => {
    const person = await api.person({ name: 'Example Person' });
    const entry = await api.planting({ label: 'Example entry' });
    await api.note({ body: 'with person', links: [{ type: 'person', id: person.id }] });
    await api.note({ body: 'with entry', links: [{ type: 'planting', id: entry.id }] });
    await api.note({ body: 'neither' });
    expect(ids(await api.notes(`?person=${person.id}`))).toEqual(['with person']);
    expect(ids(await api.notes(`?planting=${entry.id}`))).toEqual(['with entry']);
  });

  it('count matches the list for every filter', async () => {
    await seed();
    for (const q of [
      '',
      '?flag=question',
      '?tag=idea',
      '?undated=1',
      '?state=open',
      '?flag=discovery&tag=idea',
    ]) {
      const page = await api.notes(`${q}${q ? '&' : '?'}limit=100`);
      const { count } = await api.json<{ count: number }>(
        await t.call('GET', `/api/notes/count${q}`),
      );
      expect(count, q).toBe(page.items.length);
    }
  });

  it('never returns soft-deleted notes', async () => {
    const n = await seed();
    await t.call('DELETE', `/api/notes/${n.b.id}`);
    expect(ids(await api.notes())).not.toContain('b');
    expect(ids(await api.notes('?tag=other'))).toEqual([]);
  });

  it('pages with a keyset cursor: no duplicates, no gaps, in both directions', async () => {
    for (let i = 0; i < 23; i++) {
      await api.note({ body: `n${i}`, gameDate: i % 5 === 0 ? null : k(1, i % 4, (i % 3) + 1) });
    }
    for (const order of ['desc', 'asc']) {
      const full = (await api.notes(`?order=${order}&limit=100`)).items.map((n) => n.id);
      expect(full).toHaveLength(23);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page: { items: Note[]; nextCursor: string | null } = await api.notes(
          `?order=${order}&limit=7${cursor ? `&cursor=${cursor}` : ''}`,
        );
        seen.push(...page.items.map((n) => n.id));
        cursor = page.nextCursor;
        pages++;
      } while (cursor);
      expect(pages).toBe(4);
      expect(seen, order).toEqual(full);
    }
  });

  it('pages correctly across notes created in the same millisecond', async () => {
    for (let i = 0; i < 9; i++) {
      await t.call('POST', '/api/notes', { body: `same${i}`, gameDate: k(1, 0, 1) });
    }
    const full = (await api.notes('?limit=100')).items.map((n) => n.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: Note[]; nextCursor: string | null } = await api.notes(
        `?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...page.items.map((n) => n.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(full);
    expect(new Set(seen).size).toBe(9);
  });

  it('rejects bad query values', async () => {
    for (const q of [
      '?limit=0',
      '?limit=101',
      '?order=sideways',
      '?flag=nope',
      '?cursor=%%%',
      '?gameDate=abc',
      '?person=x',
    ]) {
      expect((await api.error(await t.call('GET', `/api/notes${q}`), 400)).code, q).toBe(
        'validation_failed',
      );
    }
  });
});
