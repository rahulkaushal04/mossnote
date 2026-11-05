import { describe, expect, it } from 'vitest';
import { DAY, dumpAllText, setup, unwrap } from '../notes/util.ts';

describe('CS-5 trash', () => {
  it('folder trash is ONE row on the folder; descendants are trashed by derivation and restore round-trips', () => {
    const w = setup();
    const a = unwrap(w.folders.create({}, { name: 'a' }));
    const b = unwrap(w.folders.create({}, { name: 'b', parentId: a.id }));
    const n = unwrap(w.notes.create({}, { title: 'n', body: 'x', folderId: b.id }));
    const before = w.logCount();
    const { batchId } = unwrap(w.trash.trashFolder({}, a.id));
    expect(w.logCount()).toBe(before + 1);
    expect(w.lastRow()).toMatchObject({ entity: 'folder', entityId: a.id, op: 'trash' });
    expect(unwrap(w.folders.get(b.id)).trashed).toBe(true);
    expect(unwrap(w.notes.get(n.id)).trashed).toBe(true);
    // structure untouched, descendants' own columns untouched
    expect(w.store.db.prepare('SELECT trashed_at FROM notes').get()).toEqual({ trashed_at: null });
    expect(unwrap(w.trash.list()).map((i) => i.id)).toEqual([a.id]);

    unwrap(w.trash.restoreBatch({}, batchId));
    expect(w.logCount()).toBe(before + 2);
    expect(unwrap(w.notes.get(n.id))).toMatchObject({ trashed: false, folderId: b.id });
    expect(unwrap(w.folders.get(b.id))).toMatchObject({ trashed: false, parentId: a.id });
  });

  it('a note trashed on its own stays trashed when its folder is restored', () => {
    const w = setup();
    const f = unwrap(w.folders.create({}, { name: 'f' }));
    const n = unwrap(w.notes.create({}, { title: 'n', body: 'x', folderId: f.id }));
    unwrap(w.trash.trashNote({}, n.id));
    const { batchId } = unwrap(w.trash.trashFolder({}, f.id));
    unwrap(w.trash.restoreBatch({}, batchId));
    expect(unwrap(w.notes.get(n.id)).trashed).toBe(true);
    expect(w.trash.trashNote({}, n.id).ok).toBe(false); // already trashed
  });

  it('restoring under a trashed parent returns the item to top level in the same row', () => {
    const w = setup();
    const a = unwrap(w.folders.create({}, { name: 'a' }));
    const n = unwrap(w.notes.create({}, { title: 'n', body: 'x', folderId: a.id }));
    const nb = unwrap(w.trash.trashNote({}, n.id)).batchId;
    unwrap(w.trash.trashFolder({}, a.id));
    const c = w.logCount();
    unwrap(w.trash.restoreBatch({}, nb));
    expect(w.logCount()).toBe(c + 1);
    expect(w.lastRow().fields).toMatchObject({ folderId: null });
    expect(unwrap(w.notes.get(n.id))).toMatchObject({ folderId: null, trashed: false });
  });

  it('purge writes one row listing every id, one tombstone per id, redacts fields, leaves no body', () => {
    const w = setup();
    const a = unwrap(w.folders.create({}, { name: 'FOLDERNAME-zz' }));
    const b = unwrap(w.folders.create({}, { name: 'b', parentId: a.id }));
    const n1 = unwrap(
      w.notes.create({}, { title: 'TITLE-1', body: 'BODY-1-secret', folderId: a.id }),
    );
    const n2 = unwrap(
      w.notes.create({}, { title: 'TITLE-2', body: 'BODY-2-secret', folderId: b.id }),
    );
    const keep = unwrap(w.notes.create({}, { title: 'keep', body: 'keepbody' }));
    unwrap(w.notes.update({}, n1.id, { body: 'BODY-1-edited-secret' }));
    const t = unwrap(w.tags.create({}, 'tg'));
    unwrap(w.tags.tagNote({}, n1.id, t.id));
    const { batchId } = unwrap(w.trash.trashFolder({}, a.id));
    expect(w.trash.purgeBatch({}, batchId, {}).ok).toBe(false); // needs confirmed:true
    expect(w.tombstones()).toEqual([]);
    const c = w.logCount();
    expect(unwrap(w.trash.purgeBatch({}, batchId, { confirmed: true })).purged).toBe(4);
    expect(w.logCount()).toBe(c + 1);
    const row = w.lastRow();
    expect(row).toMatchObject({ op: 'purge', entityId: a.id });
    expect(row.purgedIds!.map((x) => x.id).sort()).toEqual([a.id, b.id, n1.id, n2.id].sort());
    expect(w.tombstones()).toEqual([a.id, b.id, n1.id, n2.id].sort());
    const dump = dumpAllText(w);
    for (const s of ['BODY-1', 'BODY-2', 'TITLE-1', 'TITLE-2', 'FOLDERNAME'])
      expect(dump).not.toContain(s);
    expect(dump).toContain('keepbody');
    expect(unwrap(w.notes.get(keep.id)).body).toBe('keepbody');
    expect(w.notes.get(n1.id).ok).toBe(false);
    expect(
      unwrap(w.store.changelog.read({ limit: 100 }))
        .filter((r) => r.entityId === n1.id)
        .every((r) => r.fields === null || r.op === 'purge'),
    ).toBe(true);
  });

  it('retention expiry: day 31 without notice purges nothing; with notice it purges; setting honoured', () => {
    const w = setup();
    const n = unwrap(w.notes.create({}, { title: 'n', body: 'x' }));
    const { batchId } = unwrap(w.trash.trashNote({}, n.id));
    w.clock.t += 31 * DAY;
    expect(unwrap(w.trash.purgeExpired()).batches).toEqual([]);
    expect(unwrap(w.notes.get(n.id)).trashed).toBe(true);
    expect(unwrap(w.trash.listExpiring(0)).map((i) => i.batchId)).toEqual([batchId]);
    const c = w.logCount();
    unwrap(w.trash.recordNotice([batchId]));
    expect(w.logCount()).toBe(c); // notices are not logged
    expect(unwrap(w.trash.purgeExpired({ actor: 'system' })).batches).toEqual([batchId]);
    expect(w.logCount()).toBe(c + 1);
    expect(w.tombstones()).toEqual([n.id]);
    expect(w.lastRow()).toMatchObject({ op: 'purge', actorId: 'system' });

    unwrap(w.trash.setRetentionDays(60));
    const m = unwrap(w.notes.create({}, { title: 'm', body: 'y' }));
    const mb = unwrap(w.trash.trashNote({}, m.id)).batchId;
    unwrap(w.trash.recordNotice([mb]));
    w.clock.t += 59 * DAY;
    expect(unwrap(w.trash.purgeExpired()).batches).toEqual([]);
    w.clock.t += 1 * DAY;
    expect(unwrap(w.trash.purgeExpired()).batches).toEqual([mb]);
  });

  it('an expired folder is not purged while something inside it lacks its own notice', () => {
    const w = setup();
    const f = unwrap(w.folders.create({}, { name: 'f' }));
    const n = unwrap(w.notes.create({}, { title: 'n', body: 'x', folderId: f.id }));
    unwrap(w.trash.trashNote({}, n.id));
    const fb = unwrap(w.trash.trashFolder({}, f.id)).batchId;
    unwrap(w.trash.recordNotice([fb]));
    w.clock.t += 31 * DAY;
    expect(unwrap(w.trash.purgeExpired()).batches).toEqual([]);
    expect(w.notes.get(n.id).ok).toBe(true);
  });
});
