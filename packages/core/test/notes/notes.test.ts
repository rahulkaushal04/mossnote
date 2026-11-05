import { describe, expect, it } from 'vitest';
import { sha256 } from '../../src/db/hash.ts';
import { setup, unwrap } from './util.ts';

describe('CS-4 notes', () => {
  it('create/read/update/rename/move/favorite each write exactly one log row; body never inline', () => {
    const w = setup();
    const f = unwrap(w.folders.create({}, { name: 'F' }));
    const n = unwrap(w.notes.create({}, { title: 'T', body: 'secret body', folderId: f.id }));
    expect(w.logCount()).toBe(2);
    expect(n).toMatchObject({
      title: 'T',
      folderId: f.id,
      favorite: false,
      trashed: false,
      rev: 1,
    });
    expect(n.contentHash).toBe(sha256('secret body'));
    expect(unwrap(w.notes.get(n.id)).body).toBe('secret body');

    unwrap(w.notes.update({}, n.id, { title: 'T2' })); // rename
    unwrap(w.notes.update({}, n.id, { body: 'second' }));
    unwrap(w.notes.move({}, n.id, null));
    unwrap(w.notes.setFavorite({}, n.id, true));
    expect(w.logCount()).toBe(6);
    const rows = unwrap(w.store.changelog.read({ limit: 100 })).filter((r) => r.entity === 'note');
    expect(rows.map((r) => r.op)).toEqual(['create', 'update', 'update', 'move', 'update']);
    expect(JSON.stringify(rows)).not.toContain('secret body');
    expect(JSON.stringify(rows)).not.toContain('second');
    const upd = rows[2]!;
    expect(upd.contentHash).toBe(sha256('second'));
    expect(upd.baseContentHash).toBe(sha256('secret body'));
    expect(unwrap(w.notes.get(n.id))).toMatchObject({
      title: 'T2',
      body: 'second',
      folderId: null,
      favorite: true,
      rev: 3,
    });
  });

  it('no-ops write no row; favorite is a toggle', () => {
    const w = setup();
    const n = unwrap(w.notes.create({}, { title: 'T', body: 'b' }));
    const before = w.logCount();
    unwrap(w.notes.update({}, n.id, { title: 'T', body: 'b' }));
    unwrap(w.notes.move({}, n.id, null));
    unwrap(w.notes.setFavorite({}, n.id, false));
    expect(w.logCount()).toBe(before);
    unwrap(w.notes.setFavorite({}, n.id, true));
    unwrap(w.notes.setFavorite({}, n.id, false));
    expect(w.logCount()).toBe(before + 2);
  });

  it('failures write no row and change nothing', () => {
    const w = setup();
    const n = unwrap(w.notes.create({}, { title: 'T', body: 'b' }));
    const before = w.logCount();
    const bad = [
      w.notes.create({}, { title: 1 }),
      w.notes.create({}, { title: 't', body: 'b', folderId: 'nope' }),
      w.notes.update({}, 'nope', { body: 'x' }),
      w.notes.update({}, n.id, { body: 5 }),
      w.notes.update({}, n.id, { extra: 1 }),
      w.notes.move({}, n.id, 'nope'),
      w.notes.update({ actor: '' }, n.id, { body: 'x' }),
    ];
    expect(bad.map((r) => r.ok)).toEqual(bad.map(() => false));
    expect(w.logCount()).toBe(before);
    expect(unwrap(w.notes.get(n.id)).body).toBe('b');
  });

  it('compare-and-set: a stale expectedContentHash is a conflict and changes nothing', () => {
    const w = setup();
    const n = unwrap(w.notes.create({}, { title: 'T', body: 'v1' }));
    unwrap(w.notes.update({}, n.id, { body: 'v2' }));
    const r = w.notes.update({ expectedContentHash: n.contentHash }, n.id, { body: 'v3' });
    expect(r).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(unwrap(w.notes.get(n.id)).body).toBe('v2');
    unwrap(w.notes.update({ expectedContentHash: sha256('v2') }, n.id, { body: 'v3' }));
  });

  it('trashed notes cannot be edited or moved into; list filters by derived state', () => {
    const w = setup();
    const f = unwrap(w.folders.create({}, { name: 'F' }));
    const n = unwrap(w.notes.create({}, { title: 'T', body: 'b', folderId: f.id }));
    unwrap(w.trash.trashFolder({}, f.id));
    expect(unwrap(w.notes.get(n.id)).trashed).toBe(true);
    expect(w.notes.update({}, n.id, { body: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(w.notes.create({}, { title: 'a', body: 'b', folderId: f.id }).ok).toBe(false);
    expect(unwrap(w.notes.list()).length).toBe(0);
    expect(unwrap(w.notes.list({ trashed: true })).map((x) => x.id)).toEqual([n.id]);
    expect(unwrap(w.notes.list({ trashed: true }))[0]).not.toHaveProperty('body');
  });
});
