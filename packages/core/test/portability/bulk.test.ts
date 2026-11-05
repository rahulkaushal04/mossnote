import { describe, expect, it } from 'vitest';
import { err, ok } from '../../src/result.ts';
import { count, openFx, must, seed } from './util.ts';

const logRows = (w: ReturnType<typeof openFx>['w']) =>
  w.store.db.prepare('SELECT entity, entity_id, op, seq, hlc FROM change_log ORDER BY seq').all() as { entity: string; entity_id: string; op: string; seq: number; hlc: string }[];

describe('mutateMany (CS-3 note, decision M9)', () => {
  it('commits N entity changes in one transaction with one log row each and consecutive sequence numbers', () => {
    const f = openFx();
    const before = logRows(f.w).length;
    const r = f.w.store.mutateMany({}, (tx) => {
      for (const k of ['a', 'b', 'c']) {
        const l = tx.log({ entity: 'setting', entityId: k, op: 'update' });
        if (!l.ok) return l;
      }
      return ok(3);
    });
    expect(r).toEqual({ ok: true, value: 3 });
    const rows = logRows(f.w).slice(before);
    expect(rows.map((x) => x.entity_id)).toEqual(['a', 'b', 'c']);
    expect(rows.map((x) => x.seq)).toEqual([rows[0]!.seq, rows[0]!.seq + 1, rows[0]!.seq + 2]);
    expect(new Set(rows.map((x) => x.hlc)).size).toBe(3);
    expect([...rows.map((x) => x.hlc)].sort()).toEqual(rows.map((x) => x.hlc));
  });
  it('rolls everything back on an error result or a throw', () => {
    const f = openFx();
    const before = logRows(f.w).length;
    const bad = f.w.store.mutateMany({}, (tx) => {
      tx.log({ entity: 'setting', entityId: 'a', op: 'update' });
      tx.db.prepare("INSERT INTO meta(key, value) VALUES ('rollback_probe', '1')").run();
      tx.log({ entity: 'setting', entityId: 'b', op: 'update' });
      return err('conflict', 'nope');
    });
    expect(bad).toMatchObject({ ok: false, error: { code: 'conflict' } });
    const thrown = f.w.store.mutateMany({}, (tx) => {
      tx.log({ entity: 'setting', entityId: 'a', op: 'update' });
      throw new Error('boom');
    });
    expect(thrown.ok).toBe(false);
    expect(logRows(f.w)).toHaveLength(before);
    expect(f.w.store.db.prepare("SELECT 1 FROM meta WHERE key = 'rollback_probe'").get()).toBeUndefined();
    // and the connection is usable afterwards
    expect(f.w.store.mutateMany({}, () => ok(1))).toEqual({ ok: true, value: 1 });
  });
  it('mutate keeps its one-row-per-action rule', () => {
    const f = openFx();
    const r = f.w.store.mutate({}, (tx) => {
      const a = tx.log({ entity: 'setting', entityId: 'a', op: 'update' });
      return a.ok ? tx.log({ entity: 'setting', entityId: 'b', op: 'update' }) : a;
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});

describe('bulk operations (PT-11)', () => {
  it('move: one transaction, previous folders returned, the inverse call is the undo, no-ops write nothing', () => {
    const f = openFx();
    const { noteIds, folderIds } = seed(f.w, 8);
    const ids = noteIds.slice(0, 5);
    const before = logRows(f.w).length;
    const prev = ids.map((id) => ({ id, folderId: must(f.w.notes.get(id)).folderId }));
    const r = must(f.w.portability.bulk.move({ items: ids.map((id) => ({ id, folderId: folderIds[0]! })) }));
    expect(r.skipped).toEqual([]);
    expect(r.previous.length).toBeGreaterThan(0);
    const moved = r.previous.map((p) => p.id);
    expect(logRows(f.w).slice(before)).toHaveLength(moved.length); // one row per note changed, none for no-ops
    for (const id of ids) expect(must(f.w.notes.get(id)).folderId).toBe(folderIds[0]);
    must(f.w.portability.bulk.move({ items: r.previous.map((p) => ({ id: p.id, folderId: p.folderId })), undo: true }));
    for (const p of prev) expect(must(f.w.notes.get(p.id)).folderId).toBe(p.folderId);
    expect(must(f.w.search.verify()).ok).toBe(true);
  });
  it('move is all or nothing: one bad id changes nothing', () => {
    const f = openFx();
    const { noteIds, folderIds } = seed(f.w, 4);
    const before = logRows(f.w).length;
    const snap = noteIds.map((id) => must(f.w.notes.get(id)).folderId);
    for (const items of [
      [{ id: noteIds[0]!, folderId: folderIds[0]! }, { id: 'missing-note-id', folderId: folderIds[0]! }],
      [{ id: noteIds[0]!, folderId: folderIds[0]! }, { id: noteIds[1]!, folderId: 'no-such-folder' }],
      [{ id: noteIds[0]!, folderId: folderIds[0]! }, { id: noteIds[0]!, folderId: null }],
    ])
      expect(f.w.portability.bulk.move({ items }).ok).toBe(false);
    expect(logRows(f.w)).toHaveLength(before);
    expect(noteIds.map((id) => must(f.w.notes.get(id)).folderId)).toEqual(snap);
    expect(f.w.portability.bulk.move({ items: [] }).ok).toBe(false);
  });
  it('undoing a move into a folder that was trashed meanwhile skips and reports instead of trashing', () => {
    const f = openFx();
    const { noteIds, folderIds } = seed(f.w, 4);
    const target = noteIds.find((id) => must(f.w.notes.get(id)).folderId === folderIds[1])!;
    const first = must(f.w.portability.bulk.move({ items: [{ id: target, folderId: null }] }));
    expect(first.previous).toEqual([{ id: target, folderId: folderIds[1] }]);
    must(f.w.trash.trashFolder({}, folderIds[1]!)); // the old folder is in the trash now
    const undo = must(f.w.portability.bulk.move({ items: first.previous, undo: true }));
    expect(undo).toEqual({ previous: [], skipped: [target] });
    expect(must(f.w.notes.get(target))).toMatchObject({ folderId: null, trashed: false });
    // the strict (non-undo) form refuses
    expect(f.w.portability.bulk.move({ items: first.previous }).ok).toBe(false);
  });
  it('tag: on/off, only real changes are logged and returned, undo is the inverse', () => {
    const f = openFx();
    const { noteIds } = seed(f.w, 6);
    const tag = must(f.w.tags.create({}, 'bulk'));
    must(f.w.tags.tagNote({}, noteIds[0]!, tag.id));
    const before = logRows(f.w).length;
    const r = must(f.w.portability.bulk.tag({ ids: noteIds.slice(0, 4), tagId: tag.id, on: true }));
    expect(r.changed).toEqual(noteIds.slice(1, 4));
    expect(logRows(f.w).slice(before)).toHaveLength(3);
    expect(logRows(f.w).slice(before).every((x) => x.entity === 'note_tag')).toBe(true);
    must(f.w.portability.bulk.tag({ ids: r.changed, tagId: tag.id, on: false, undo: true }));
    expect(must(f.w.tags.listForNote(noteIds[2]!))).toEqual([]);
    expect(must(f.w.tags.listForNote(noteIds[0]!))).toHaveLength(2); // alpha from the seed + bulk
    expect(f.w.portability.bulk.tag({ ids: noteIds, tagId: 'nope', on: true })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    // a trashed note fails a normal call (nothing changes) but is skipped by an undo
    must(f.w.trash.trashNote({}, noteIds[5]!));
    const n = logRows(f.w).length;
    expect(f.w.portability.bulk.tag({ ids: [noteIds[4]!, noteIds[5]!], tagId: tag.id, on: true }).ok).toBe(false);
    expect(logRows(f.w)).toHaveLength(n);
    expect(must(f.w.portability.bulk.tag({ ids: [noteIds[4]!, noteIds[5]!], tagId: tag.id, on: true, undo: true }))).toMatchObject({ changed: [noteIds[4]], skipped: [noteIds[5]] });
  });
  it('trash gives every note its own batch id; untrash restores them in one call (the single Undo)', () => {
    const f = openFx();
    const { noteIds } = seed(f.w, 6);
    const ids = noteIds.slice(0, 4);
    const before = logRows(f.w).length;
    const t = must(f.w.portability.bulk.trash({ ids }));
    expect(new Set(t.batchIds).size).toBe(4);
    expect(logRows(f.w).slice(before).map((x) => x.op)).toEqual(['trash', 'trash', 'trash', 'trash']);
    expect(must(f.w.trash.list()).filter((x) => x.entity === 'note')).toHaveLength(4);
    for (const id of ids) expect(must(f.w.notes.get(id)).trashed).toBe(true);
    // each is restorable alone
    must(f.w.trash.restoreBatch({}, t.batchIds[0]!));
    // one purged meanwhile: counted, not fatal
    must(f.w.trash.purgeBatch({}, t.batchIds[1]!, { confirmed: true }));
    const u = must(f.w.portability.bulk.untrash({ batchIds: t.batchIds }));
    expect(u).toMatchObject({ restored: 2, skipped: 2 });
    expect(u.ids.sort()).toEqual([ids[2]!, ids[3]!].sort());
    expect(must(f.w.notes.get(ids[3]!)).trashed).toBe(false);
    expect(count(f.w, 'notes')).toBe(5);
    expect(must(f.w.search.verify()).ok).toBe(true);
  });
  it('trash is all or nothing and refuses an already trashed note', () => {
    const f = openFx();
    const { noteIds } = seed(f.w, 3);
    must(f.w.trash.trashNote({}, noteIds[2]!));
    const n = logRows(f.w).length;
    expect(f.w.portability.bulk.trash({ ids: [noteIds[0]!, noteIds[1]!, noteIds[2]!] }).ok).toBe(false);
    expect(logRows(f.w)).toHaveLength(n);
    expect(must(f.w.notes.get(noteIds[0]!)).trashed).toBe(false);
  });
});
