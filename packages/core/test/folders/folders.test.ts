import { describe, expect, it } from 'vitest';
import { setup, unwrap } from '../notes/util.ts';

describe('CS-4 folders', () => {
  it('nests to depth 50 and rejects 51 with no row', () => {
    const w = setup();
    let parent: string | null = null;
    for (let i = 0; i < 50; i++)
      parent = unwrap(w.folders.create({}, { name: `d${i}`, parentId: parent })).id;
    const before = w.logCount();
    expect(w.folders.create({}, { name: 'x', parentId: parent })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(w.logCount()).toBe(before);
  });

  it('rejects a move under itself or a descendant, and a move that pushes the subtree past 50', () => {
    const w = setup();
    const a = unwrap(w.folders.create({}, { name: 'a' }));
    const b = unwrap(w.folders.create({}, { name: 'b', parentId: a.id }));
    const c = unwrap(w.folders.create({}, { name: 'c', parentId: b.id }));
    const before = w.logCount();
    for (const target of [a.id, b.id, c.id])
      expect(w.folders.move({}, a.id, target)).toMatchObject({
        ok: false,
        error: { code: 'validation' },
      });
    expect(w.logCount()).toBe(before);
    expect(unwrap(w.folders.get(a.id)).parentId).toBeNull();
    // a chain of 49 under root; moving the 3-deep subtree under its end would reach 52
    let p: string | null = null;
    for (let i = 0; i < 49; i++)
      p = unwrap(w.folders.create({}, { name: `x${i}`, parentId: p })).id;
    expect(w.folders.move({}, a.id, p).ok).toBe(false);
    const q = unwrap(w.folders.create({}, { name: 'deep', parentId: p })); // depth 50
    expect(q.parentId).toBe(p);
  });

  it('rename and legal move are single rows; same-parent move is a no-op', () => {
    const w = setup();
    const a = unwrap(w.folders.create({}, { name: 'a' }));
    const b = unwrap(w.folders.create({}, { name: 'b' }));
    const n = w.logCount();
    unwrap(w.folders.rename({}, a.id, ' renamed '));
    unwrap(w.folders.move({}, a.id, b.id));
    unwrap(w.folders.move({}, a.id, b.id));
    expect(w.logCount()).toBe(n + 2);
    expect(unwrap(w.folders.get(a.id))).toMatchObject({ name: 'renamed', parentId: b.id });
    expect(w.folders.rename({}, a.id, '   ').ok).toBe(false);
  });
});
