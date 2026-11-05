import { describe, expect, it } from 'vitest';
import { find, ids, mkNote, openWs, unwrap } from './util.ts';

describe('search basics (SR-1)', () => {
  it('finds title, body and tag text; title outranks body; markers become ranges', () => {
    const { w } = openWs();
    const body = mkNote(w, 'Groceries', 'remember the zebra stripes');
    const title = mkNote(w, 'Zebra facts', 'animals');
    const tagged = mkNote(w, 'Other', 'nothing here');
    const tag = unwrap(w.tags.create({}, 'zebra')).id;
    unwrap(w.tags.tagNote({}, tagged, tag));
    const r = find(w, 'zebra');
    expect(new Set(ids(r))).toEqual(new Set([body, title, tagged]));
    expect(ids(r)[0]).toBe(title); // title weight > tags > body
    expect(ids(r)[1]).toBe(tagged);
    const t = r.hits[0]!;
    expect(t.title.text.slice(...t.title.ranges[0]!)).toBe('Zebra');
    const b = r.hits.find((h) => h.noteId === body)!;
    expect(b.snippet.text).toContain('zebra');
    expect(b.snippet.text.slice(...b.snippet.ranges[0]!)).toBe('zebra');
    expect(r.hits.every((h) => !h.trashed)).toBe(true);
  });

  it('phrases, prefixes, exclusion and exclusion-only queries', () => {
    const { w } = openWs();
    const a = mkNote(w, 'a', 'the quick brown fox');
    const b = mkNote(w, 'b', 'quick thinking brown');
    const c = mkNote(w, 'c', 'nothing');
    expect(ids(find(w, '"quick brown"'))).toEqual([a]);
    expect(new Set(ids(find(w, 'qui*')))).toEqual(new Set([a, b]));
    expect(ids(find(w, 'quick -fox'))).toEqual([b]);
    expect(new Set(ids(find(w, '-fox')))).toEqual(new Set([b, c])); // exclusion only: rid NOT IN (...)
  });

  it('empty query and unsearchable input reply with a readable message, not an error', () => {
    const { w } = openWs();
    mkNote(w, 'x', 'y');
    const r = find(w, '   ');
    expect(r.hits).toEqual([]);
    expect(r.messages.join(' ')).toMatch(/search/i);
    expect(find(w, '"*" ( ) ^ AND OR NOT NEAR').hits).toEqual([]);
  });

  it('surfaces parser messages and unknown tag/folder names', () => {
    const { w } = openWs();
    mkNote(w, 'x', 'hello');
    expect(find(w, 'hello tag:nope').messages.join(' ')).toContain('No tag named');
    expect(find(w, 'hello tag:nope').hits).toEqual([]);
    expect(find(w, 'hello folder:nope').messages.join(' ')).toContain('No folder named');
    expect(find(w, 'hello -tag:x').messages.join(' ')).toMatch(/isn't supported/);
  });

  it('folder:Name on a trashed folder says so instead of returning nothing silently', () => {
    const { w } = openWs();
    const f = unwrap(w.folders.create({}, { name: 'Projects' })).id;
    mkNote(w, 'inside', 'hello', f);
    expect(ids(find(w, 'hello folder:Projects'))).toHaveLength(1);
    unwrap(w.trash.trashFolder({}, f));
    const r = find(w, 'hello folder:Projects');
    expect(r.hits).toEqual([]);
    expect(r.messages.join(' ')).toContain('is in the trash');
    expect(r.messages.join(' ')).not.toContain('No folder named');
    expect(find(w, 'hello folder:Nope').messages.join(' ')).toContain('No folder named');
  });

  it('notes containing the highlight marker characters cannot forge highlights', () => {
    const { w } = openWs();
    const n = mkNote(w, 'x\u0002fake\u0003', 'plain body \u0002fake\u0003 text hello');
    const r = find(w, 'hello');
    const h = r.hits.find((x) => x.noteId === n)!;
    expect(h.title.ranges).toEqual([]);
    expect(h.snippet.ranges.map(([a, b]) => h.snippet.text.slice(a, b))).toEqual(['hello']);
    // eslint-disable-next-line no-control-regex
    expect(h.snippet.text).not.toMatch(/[\u0002\u0003]/);
  });

  it('NUL and lone surrogates in a note do not break search or shift ranges', () => {
    const { w } = openWs();
    const n = mkNote(w, 'nul', 'before\u0000after \ud800 findme end');
    const h = find(w, 'findme').hits.find((x) => x.noteId === n)!;
    expect(h.snippet.ranges.map(([a, b]) => h.snippet.text.slice(a, b))).toEqual(['findme']);
    expect(unwrap(w.search.verify()).ok).toBe(true);
  });
});

describe('visibility (derived trash, scopes)', () => {
  it('trashed notes and notes in trashed folders are hidden; root notes stay; trash scope shows only them', () => {
    const { w } = openWs();
    const root = mkNote(w, 'rootnote kiwi');
    const f = unwrap(w.folders.create({}, { name: 'F' })).id;
    const sub = unwrap(w.folders.create({}, { name: 'S', parentId: f })).id;
    const inSub = mkNote(w, 'deep kiwi', '', sub);
    const single = mkNote(w, 'single kiwi');
    unwrap(w.trash.trashNote({}, single));
    expect(ids(find(w, 'kiwi')).sort()).toEqual([root, inSub].sort());
    const fb = unwrap(w.trash.trashFolder({}, f)).batchId;
    expect(ids(find(w, 'kiwi'))).toEqual([root]);
    const t = find(w, 'kiwi', { scope: { kind: 'trash' } });
    expect(new Set(ids(t))).toEqual(new Set([inSub, single]));
    expect(t.hits.every((h) => h.trashed)).toBe(true);
    unwrap(w.trash.restoreBatch({}, fb));
    expect(new Set(ids(find(w, 'kiwi')))).toEqual(new Set([root, inSub]));
  });

  it('favorites, tag and folder-subtree scopes', () => {
    const { w } = openWs();
    const f = unwrap(w.folders.create({}, { name: 'F' })).id;
    const sub = unwrap(w.folders.create({}, { name: 'S', parentId: f })).id;
    const a = mkNote(w, 'plum a', '', f);
    const b = mkNote(w, 'plum b', '', sub);
    const c = mkNote(w, 'plum c');
    unwrap(w.notes.setFavorite({}, c, true));
    const tag = unwrap(w.tags.create({}, 'fruit')).id;
    unwrap(w.tags.tagNote({}, a, tag));
    expect(ids(find(w, 'plum', { scope: { kind: 'favorites' } }))).toEqual([c]);
    expect(ids(find(w, 'plum', { scope: { kind: 'tag', id: tag } }))).toEqual([a]);
    expect(new Set(ids(find(w, 'plum', { scope: { kind: 'folder', id: f } })))).toEqual(
      new Set([a, b]),
    );
    expect(ids(find(w, 'plum folder:S'))).toEqual([b]);
    expect(ids(find(w, 'plum tag:FRUIT'))).toEqual([a]);
  });

  it('filters combine with AND and work without text', () => {
    const { w, clock } = openWs();
    const mk = (t: string, at: number) => {
      clock.t = at;
      return mkNote(w, t, 'melon');
    };
    const a = mk('a', 1000);
    const b = mk('b', 2000);
    const c = mk('c', 3000);
    unwrap(w.notes.setFavorite({}, b, true));
    expect(ids(find(w, 'melon', { filters: { createdFrom: 2000 } })).sort()).toEqual([b, c]);
    expect(ids(find(w, 'melon', { filters: { createdFrom: 2000, createdTo: 2000 } }))).toEqual([b]);
    expect(ids(find(w, 'melon', { filters: { createdFrom: 2000, favorite: true } }))).toEqual([b]);
    expect(ids(find(w, '', { filters: { favorite: true } }))).toEqual([b]); // filter-only
    expect(ids(find(w, '', { filters: { updatedTo: 1500 } }))).toEqual([a]);
    const tag = unwrap(w.tags.create({}, 't')).id;
    unwrap(w.tags.tagNote({}, a, tag));
    unwrap(w.tags.tagNote({}, c, tag));
    expect(ids(find(w, '', { filters: { tagIds: [tag], favorite: false } })).sort()).toEqual([
      a,
      c,
    ]);
    expect(ids(find(w, 'melon', { filters: { tagIds: [tag], createdFrom: 3000 } }))).toEqual([c]);
  });
});

describe('sort and paging (SR-6)', () => {
  const setupNotes = () => {
    const s = openWs();
    const { w, clock } = s;
    const titles = ['banana', 'Äpfel', 'apple', 'Zebra', 'éclair', 'apple'];
    const noteIds = titles.map((t, i) => {
      clock.t = 10_000 + (i % 3) * 1000; // ties on created/updated
      return mkNote(w, `${t} fruit`);
    });
    return { ...s, noteIds, titles };
  };

  it('sorts by updated/created (ties by id) and title (Unicode-aware), both directions', () => {
    const { w, noteIds } = setupNotes();
    const rows = noteIds.map((id) => unwrap(w.notes.get(id)));
    const expectOrder = (
      sort: string,
      dir: string,
      cmp: (a: (typeof rows)[0], b: (typeof rows)[0]) => number,
    ) => {
      const want = [...rows].sort((a, b) => cmp(a, b) || (a.id < b.id ? -1 : 1)).map((r) => r.id);
      expect(ids(find(w, 'fruit', { sort, dir })), `${sort} ${dir}`).toEqual(want);
    };
    expectOrder('updated', 'desc', (a, b) => b.updatedAt - a.updatedAt);
    expectOrder('updated', 'asc', (a, b) => a.updatedAt - b.updatedAt);
    expectOrder('created', 'desc', (a, b) => b.createdAt - a.createdAt);
    const key = (t: string) => t.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    expectOrder('title', 'asc', (a, b) =>
      key(a.title) < key(b.title) ? -1 : key(a.title) > key(b.title) ? 1 : 0,
    );
    expectOrder('title', 'desc', (a, b) =>
      key(a.title) < key(b.title) ? 1 : key(a.title) > key(b.title) ? -1 : 0,
    );
  });

  it.each(['relevance', 'updated', 'created', 'title'])(
    'cursor paging by %s visits every hit once',
    (sort) => {
      const { w, noteIds } = setupNotes();
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const p = find(w, 'fruit', { sort, limit: 2, cursor });
        seen.push(...ids(p));
        cursor = p.nextCursor;
        if (!cursor) break;
      }
      expect(seen.sort()).toEqual([...noteIds].sort());
    },
  );

  it('cursor is stable under a concurrent edit and rejects a mismatched search', () => {
    const { w, noteIds } = setupNotes();
    const p1 = find(w, 'fruit', { sort: 'updated', limit: 3 });
    unwrap(w.notes.update({}, noteIds[0]!, { title: 'banana fruit edited' })); // jumps to the front
    const p2 = find(w, 'fruit', { sort: 'updated', limit: 3, cursor: p1.nextCursor });
    expect(ids(p2).filter((i) => ids(p1).includes(i))).toEqual([]); // no repeats
    expect(
      w.search.search({ query: 'fruit', sort: 'created', cursor: p1.nextCursor }),
    ).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(w.search.search({ query: 'fruit', cursor: '!!' })).toMatchObject({ ok: false });
  });

  it('rejects out-of-range parameters with a readable validation error', () => {
    const { w } = openWs();
    for (const bad of [
      { limit: 0 },
      { limit: 101 },
      { query: 'x'.repeat(1001) },
      { scope: { kind: 'tag' } },
    ]) {
      const r = w.search.search({ query: 'x', ...bad } as never); // deliberately invalid
      expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
  });
});

describe('SR-8 case, diacritics, normalisation; CJK limitation', () => {
  it('matches across case and diacritics, NFC and NFD', () => {
    const { w } = openWs();
    const cafe = mkNote(w, 'Café', 'ångström and ÉCOLE');
    expect(ids(find(w, 'cafe'))).toEqual([cafe]);
    expect(ids(find(w, 'CAFÉ'))).toEqual([cafe]);
    expect(ids(find(w, 'café'))).toEqual([cafe]); // NFD input
    expect(ids(find(w, 'angstrom'))).toEqual([cafe]);
    expect(ids(find(w, 'ecole'))).toEqual([cafe]);
    expect(ids(find(w, 'école'))).toEqual([cafe]);
    const nfd = mkNote(w, 'Zürich');
    expect(ids(find(w, 'zurich'))).toEqual([nfd]);
  });

  it('documents actual behaviour for sharp s, ø, æ, ł (not folded)', () => {
    const { w } = openWs();
    const n = mkNote(w, 'Straße Søren Æsir Łódź');
    expect(ids(find(w, 'strasse'))).toEqual([]);
    expect(ids(find(w, 'soren'))).toEqual([]);
    expect(ids(find(w, 'straße'))).toEqual([n]);
    expect(ids(find(w, 'lodz'))).toEqual([]);
  });

  it('CJK: a prefix of an unspaced run matches, a mid-run substring does not (stated limitation)', () => {
    const { w } = openWs();
    const n = mkNote(w, '東京都に住む');
    expect(ids(find(w, '東京'))).toEqual([n]);
    expect(ids(find(w, '住む'))).toEqual([]);
  });
});
