import { describe, expect, it } from 'vitest';
import { openWs, unwrap } from './util.ts';

const spec = {
  query: 'a b',
  scope: { kind: 'favorites' as const },
  sort: 'title' as const,
  dir: 'asc' as const,
};

describe('SR-7 saved searches', () => {
  it('create, list, rename, delete; survive a restart', () => {
    const a = openWs();
    const s = unwrap(a.w.search.savedSearches.create('  My search ', spec));
    expect(s.name).toBe('My search');
    unwrap(a.w.search.savedSearches.rename(s.id, 'Renamed'));
    expect(unwrap(a.w.search.savedSearches.list())).toMatchObject([
      { id: s.id, name: 'Renamed', spec },
    ]);
    a.w.close();
    const b = openWs({ path: a.path });
    expect(unwrap(b.w.search.savedSearches.list())).toHaveLength(1);
    unwrap(b.w.search.savedSearches.delete(s.id));
    expect(unwrap(b.w.search.savedSearches.list())).toEqual([]);
    expect(b.w.search.savedSearches.delete(s.id)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('writes no change-log rows', () => {
    const a = openWs();
    const n = () =>
      (a.w.store.db.prepare('SELECT count(*) AS n FROM change_log').get() as { n: number }).n;
    const before = n();
    unwrap(a.w.search.savedSearches.create('x', spec));
    expect(n()).toBe(before);
  });

  it('validates names, specs, and the cap of 100', () => {
    const a = openWs();
    const sv = a.w.search.savedSearches;
    for (const bad of ['', '   ', 'x'.repeat(81)])
      expect(sv.create(bad, spec)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(sv.create('ok', { query: 1 })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(sv.create('ok', { ...spec, extra: 1 })).toMatchObject({ ok: false });
    for (let i = 0; i < 100; i++) unwrap(sv.create(`s${i}`, spec));
    expect(sv.create('one too many', spec)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('a corrupt value is kept raw, reported, never overwritten; reset is explicit (M7)', () => {
    const a = openWs();
    const db = a.w.store.db;
    db.prepare("INSERT INTO meta(key, value) VALUES ('saved_searches', '{not json')").run();
    const sv = a.w.search.savedSearches;
    expect(sv.list()).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    expect(sv.create('new', spec)).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    const raw = () =>
      (db.prepare("SELECT value FROM meta WHERE key = 'saved_searches'").get() as { value: string })
        .value;
    expect(raw()).toBe('{not json');
    unwrap(sv.reset());
    expect(unwrap(sv.list())).toEqual([]);
    expect(
      (
        db.prepare("SELECT value FROM meta WHERE key = 'saved_searches_damaged'").get() as {
          value: string;
        }
      ).value,
    ).toBe('{not json');
    unwrap(sv.create('after reset', spec));
  });

  it('an entry with keys a newer version added still lists, keeps them through rename; an unparseable one stays stored', () => {
    const a = openWs();
    const db = a.w.store.db;
    const future = {
      id: 'F1',
      name: 'future',
      spec: { query: 'q', filters: { newKey: 1, favorite: true }, newSpecKey: 'x' },
      createdAt: 1,
      updatedAt: 1,
      newEntryKey: true,
    };
    const broken = { id: 'F2', name: 'broken', spec: 5, createdAt: 1, updatedAt: 1 };
    db.prepare("INSERT INTO meta(key, value) VALUES ('saved_searches', ?)").run(
      JSON.stringify([future, broken]),
    );
    expect(unwrap(a.w.search.savedSearches.list())).toEqual([future]); // tolerated, nothing dropped
    unwrap(a.w.search.savedSearches.rename('F1', 'renamed'));
    unwrap(a.w.search.savedSearches.create('mine', spec));
    const stored = JSON.parse(
      (db.prepare("SELECT value FROM meta WHERE key = 'saved_searches'").get() as { value: string })
        .value,
    );
    expect(stored).toHaveLength(3);
    expect(stored[0]).toMatchObject({ ...future, name: 'renamed' }); // unknown keys preserved
    expect(stored[1]).toEqual(broken);
  });
});
