import { describe, expect, it } from 'vitest';
import { snapshotNote } from '../../src/versions/snapshot.ts';
import { DAY, MIN, setup, unwrap } from '../notes/util.ts';

const reasons = (w: ReturnType<typeof setup>, id: string) =>
  unwrap(w.versions.list(id))
    .map((v) => v.reason)
    .reverse();

describe('CS-6 versions', () => {
  it('edits 1 min apart make no version; >=5 min makes one; a >200-char change makes one', () => {
    const w = setup();
    const n = unwrap(w.notes.create({}, { title: 't', body: 'a' }));
    w.clock.t += MIN;
    unwrap(w.notes.update({}, n.id, { body: 'ab' }));
    expect(reasons(w, n.id)).toEqual(['edit']);
    w.clock.t += 5 * MIN;
    unwrap(w.notes.update({}, n.id, { body: 'abc' }));
    expect(reasons(w, n.id)).toEqual(['edit', 'edit']);
    w.clock.t += MIN;
    unwrap(w.notes.update({}, n.id, { body: 'abc' + 'x'.repeat(201) }));
    expect(reasons(w, n.id)).toEqual(['edit', 'edit', 'size']);
    w.clock.t += MIN;
    unwrap(w.notes.update({}, n.id, { body: 'abc' + 'x'.repeat(250) })); // only 49 more
    expect(reasons(w, n.id)).toHaveLength(3);
    // the change-log row of a throttled edit carries the hash but no version id
    expect(w.lastRow()).toMatchObject({ noteVersionId: null });
    expect(w.lastRow().contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('agent write: snapshots un-versioned current text first, then versions the result; one row', () => {
    const w = setup();
    const n = unwrap(w.notes.create({}, { title: 't', body: 'human 1' }));
    w.clock.t += MIN;
    unwrap(w.notes.update({}, n.id, { body: 'human 2 unsaved' })); // throttled, no version
    const c = w.logCount();
    unwrap(w.notes.update({ actor: 'agent-1' }, n.id, { body: 'agent text' }));
    expect(w.logCount()).toBe(c + 1);
    expect(w.lastRow().actorId).toBe('agent-1');
    const vs = unwrap(w.versions.list(n.id));
    expect(vs.map((v) => v.reason).reverse()).toEqual(['edit', 'agent', 'agent']);
    expect(unwrap(w.versions.get(vs[1]!.id)).body).toBe('human 2 unsaved');
    expect(unwrap(w.versions.get(vs[0]!.id)).body).toBe('agent text');
  });

  it('restoreVersion snapshots the current text first, keeps the old version, makes a new head', () => {
    const w = setup();
    const n = unwrap(w.notes.create({}, { title: 't', body: 'v1' }));
    w.clock.t += 6 * MIN;
    unwrap(w.notes.update({}, n.id, { body: 'v2' }));
    w.clock.t += MIN;
    unwrap(w.notes.update({}, n.id, { body: 'v3 unsaved' })); // throttled
    const first = unwrap(w.versions.list(n.id)).at(-1)!;
    const c = w.logCount();
    const r = unwrap(w.versions.restore({}, first.id));
    expect(w.logCount()).toBe(c + 1);
    expect(unwrap(w.notes.get(n.id))).toMatchObject({ body: 'v1', headVersionId: r.versionId });
    const all = unwrap(w.versions.list(n.id));
    expect(all.map((v) => v.reason).reverse()).toEqual(['edit', 'edit', 'pre_restore', 'restore']);
    expect(unwrap(w.versions.get(all.find((v) => v.reason === 'pre_restore')!.id)).body).toBe(
      'v3 unsaved',
    );
    expect(all.find((v) => v.reason === 'restore')!.parentVersionId).not.toBeNull();
    expect(w.versions.get(first.id).ok).toBe(true); // old version kept
    expect(w.lastRow()).toMatchObject({ op: 'update', noteVersionId: r.versionId });
    // stale CAS is refused
    expect(w.versions.restore({ expectedContentHash: 'f'.repeat(64) }, first.id)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
  });

  it('snapshotNote (T42 helper) forces a remote snapshot only when the head is stale; no row', () => {
    const w = setup();
    const n = unwrap(w.notes.create({}, { title: 't', body: 'a' }));
    w.clock.t += MIN;
    unwrap(w.notes.update({}, n.id, { body: 'ab' }));
    const c = w.logCount();
    const id = unwrap(w.store.mutate({}, (tx) => snapshotNote(tx, n.id, 'remote')));
    const again = unwrap(w.store.mutate({}, (tx) => snapshotNote(tx, n.id, 'remote')));
    expect(again).toBe(id);
    expect(w.logCount()).toBe(c);
    expect(reasons(w, n.id)).toEqual(['edit', 'remote']);
    const mb = unwrap(w.versions.force(n.id, 'merge_base', 'peer-1'));
    expect(mb).toBe(id); // already snapshotted
    expect(w.store.db.prepare('SELECT count(*) AS n FROM base_holds').get()).toEqual({ n: 1 });
  });

  it('thins to the latest per UTC day after 30 days; keeps heads, holds, and unacknowledged-log versions', () => {
    const w = setup();
    const day0 = Math.floor(w.clock.t / DAY) * DAY + 1000; // early in a UTC day
    w.clock.t = day0;
    const n = unwrap(w.notes.create({}, { title: 't', body: 'v0' }));
    const ids: string[] = [];
    for (let i = 1; i <= 4; i++) {
      w.clock.t = day0 + i * 6 * MIN;
      unwrap(w.notes.update({}, n.id, { body: `v${i}` }));
    }
    ids.push(
      ...unwrap(w.versions.list(n.id))
        .map((v) => v.id)
        .reverse(),
    ); // v0..v4 same day
    expect(ids).toHaveLength(5);
    w.clock.t = day0 + 29 * DAY;
    expect(unwrap(w.versions.prune()).deleted).toBe(0); // not old enough
    // hold v1; ack at v2's own row, so only rows after it (v3, v4) protect their versions
    unwrap(w.versions.hold('peer', ids[1]!));
    const v2row = unwrap(w.store.changelog.read({ limit: 1000 })).find(
      (r) => r.noteVersionId === ids[2],
    )!;
    w.store.db
      .prepare("INSERT INTO meta(key, value) VALUES ('sync_oldest_ack_hlc', ?)")
      .run(v2row.hlc);
    w.clock.t = day0 + 40 * DAY;
    unwrap(w.notes.update({}, n.id, { body: 'late' }));
    // deletable: only v0. v1 held, v3/v4 referenced by unacked rows, and v2 is the MERGE BASE
    // (base_version_id) of the unacked v3 row, so it stays until acknowledged (M6).
    const r = unwrap(w.versions.prune());
    const left = unwrap(w.versions.list(n.id)).map((v) => v.id);
    expect(r.deleted).toBe(1);
    expect(left).toContain(ids[1]);
    expect(left).toContain(ids[3]);
    expect(left).toContain(ids[4]);
    expect(left).not.toContain(ids[0]);
    expect(left).toContain(ids[2]);
    expect(left).toContain(unwrap(w.notes.get(n.id)).headVersionId);
  });
});
