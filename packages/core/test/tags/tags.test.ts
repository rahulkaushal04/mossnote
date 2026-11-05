import { describe, expect, it } from 'vitest';
import { tagKey } from '../../src/tags/tags.ts';
import { setup, unwrap } from '../notes/util.ts';

describe('CS-4/CS-17 tags', () => {
  it('are unique case-insensitively: creating again returns the existing tag with no row', () => {
    const w = setup();
    const a = unwrap(w.tags.create({}, 'Work'));
    const n = w.logCount();
    expect(unwrap(w.tags.create({}, 'WORK')).id).toBe(a.id);
    expect(w.logCount()).toBe(n);
  });

  it('key is NFKC + lower-case; full case folding (ß/ss) is not done', () => {
    expect(tagKey('Ａb')).toBe('ab'); // fullwidth A folds under NFKC
    expect(tagKey('Straße')).not.toBe(tagKey('STRASSE'));
  });

  it('colliding rename without confirmation writes nothing; case-only rename is a plain update', () => {
    const w = setup();
    const a = unwrap(w.tags.create({}, 'alpha'));
    const b = unwrap(w.tags.create({}, 'beta'));
    const n = w.logCount();
    const r = unwrap(w.tags.rename({}, b.id, 'ALPHA'));
    expect(r).toMatchObject({ kind: 'needsMerge', into: { id: a.id } });
    expect(w.logCount()).toBe(n);
    expect(unwrap(w.tags.get(b.id)).name).toBe('beta');
    const c = unwrap(w.tags.rename({}, a.id, 'Alpha'));
    expect(c).toMatchObject({ kind: 'renamed', tag: { name: 'Alpha' } });
    expect(w.logCount()).toBe(n + 1);
    expect(w.lastRow()).toMatchObject({ entity: 'tag', op: 'update' });
  });

  it('confirmed merge is ONE purge row with merged_into and a tombstone for the source tag id only', () => {
    const w = setup();
    const a = unwrap(w.tags.create({}, 'alpha'));
    const b = unwrap(w.tags.create({}, 'beta'));
    const n1 = unwrap(w.notes.create({}, { title: 'one', body: 'x' }));
    const n2 = unwrap(w.notes.create({}, { title: 'two', body: 'y' }));
    unwrap(w.tags.tagNote({}, n1.id, b.id));
    unwrap(w.tags.tagNote({}, n2.id, b.id));
    unwrap(w.tags.tagNote({}, n2.id, a.id));
    const before = w.logCount();
    const r = unwrap(w.tags.rename({}, b.id, 'Alpha', { confirmMerge: true }));
    expect(r).toMatchObject({ kind: 'merged', tag: { id: a.id } });
    expect(w.logCount()).toBe(before + 1);
    expect(w.lastRow()).toMatchObject({
      entity: 'tag',
      entityId: b.id,
      op: 'purge',
      mergedInto: a.id,
      purgedIds: [{ entity: 'tag', id: b.id }],
    });
    expect(w.tombstones()).toEqual([b.id]);
    expect(w.store.db.prepare('SELECT merged_into FROM tombstones').get()).toEqual({
      merged_into: a.id,
    });
    expect(w.tags.get(b.id)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(unwrap(w.tags.listForNote(n1.id)).map((t) => t.id)).toEqual([a.id]);
    expect(unwrap(w.tags.listForNote(n2.id)).map((t) => t.id)).toEqual([a.id]);
  });

  it('untag is note_tag update {present:false} with no tombstone; repeats are no-ops', () => {
    const w = setup();
    const t = unwrap(w.tags.create({}, 't'));
    const n = unwrap(w.notes.create({}, { title: 'n', body: 'b' }));
    unwrap(w.tags.tagNote({}, n.id, t.id));
    unwrap(w.tags.tagNote({}, n.id, t.id));
    expect(w.lastRow()).toMatchObject({
      entity: 'note_tag',
      entityId: `${n.id}:${t.id}`,
      op: 'update',
      fields: { present: true },
    });
    const c = w.logCount();
    unwrap(w.tags.untagNote({}, n.id, t.id));
    unwrap(w.tags.untagNote({}, n.id, t.id));
    expect(w.logCount()).toBe(c + 1);
    expect(w.lastRow()).toMatchObject({ fields: { present: false } });
    expect(w.tombstones()).toEqual([]);
  });
});
