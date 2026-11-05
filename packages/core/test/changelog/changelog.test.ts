import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redactFields } from '../../src/changelog/append.ts';
import { sha256 } from '../../src/db/hash.ts';
import type { RemoteChange } from '../../src/changelog/apply.ts';
import type { ChangeRow } from '../../src/changelog/read.ts';
import type { Result } from '../../src/result.ts';
import type { Store } from '../../src/store/store.ts';
import { MIGRATIONS, open, tmp } from '../store/helpers.ts';

// Valid ULIDs: change rows are validated by one schema locally and remotely.
const [N1, N2, V1, F1, T1, T9] = ['2', '3', '4', '1', '5', '6'].map((c) => c.repeat(26)) as [
  string,
  string,
  string,
  string,
  string,
  string,
];
const readRows = (r: Result<ChangeRow[]>): ChangeRow[] => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const count = (s: Store, where = '1') =>
  (s.db.prepare(`SELECT count(*) AS n FROM change_log WHERE ${where}`).get() as { n: number }).n;
const make = (clockRef = { t: 1_700_000_000_000 }) =>
  Object.assign(open(join(tmp(), 'n.db'), { clock: { now: () => clockRef.t } }), { clockRef });

describe('CS-3 change log', () => {
  it('one complete row per successful action; none for a failed or rolled-back action', () => {
    const s = make();
    const h = sha256('hello');
    const r = s.mutate({ actor: 'agent-7' }, (tx) =>
      tx.log({
        entity: 'note',
        entityId: N1,
        op: 'create',
        fields: { title: 'T' },
        noteVersionId: V1,
        contentHash: h,
      }),
    );
    expect(r.ok).toBe(true);
    const [row] = readRows(s.changelog.read({ limit: 10 }));
    expect(row).toMatchObject({
      entity: 'note',
      entityId: N1,
      op: 'create',
      deviceId: s.deviceId,
      seq: 1,
      origin: 'local',
      actorId: 'agent-7',
      schemaVersion: MIGRATIONS.length,
      fields: { title: 'T' },
      noteVersionId: V1,
      contentHash: h,
      baseVersionId: null,
      baseContentHash: null,
      purgedIds: null,
      mergedInto: null,
    });
    expect(row!.id).toMatch(/^[0-9A-Z]{26}$/);

    // body inline is rejected; an invalid action leaves the log unchanged
    const bad = s.mutate({}, (tx) =>
      tx.log({ entity: 'note', entityId: N1, op: 'update', fields: { body: 'x' } }),
    );
    expect(bad).toMatchObject({ ok: false, error: { code: 'validation' } });
    // body body-side effect written before a failing log is rolled back with it
    s.mutate({}, (tx) => {
      tx.db.prepare("INSERT INTO settings(key, value, updated_at) VALUES ('a','b',1)").run();
      return tx.log({
        entity: 'setting',
        entityId: 'a',
        op: 'update',
        fields: { body: 1 },
        mergedInto: 'x',
      });
    });
    expect(s.db.prepare('SELECT count(*) AS n FROM settings').get()).toEqual({ n: 0 });
    expect(count(s)).toBe(1);
  });

  it('logging twice in one action is an error and rolls everything back', () => {
    const s = make();
    const r = s.mutate({}, (tx) => {
      tx.log({ entity: 'setting', entityId: 'a', op: 'update' });
      return tx.log({ entity: 'setting', entityId: 'a', op: 'update' });
    });
    expect(r.ok).toBe(false);
    expect(count(s)).toBe(0);
  });

  it('seq is contiguous per device and HLC strictly increases even when the clock goes backwards', () => {
    const s = make();
    for (const t of [1000, 1000, 1000, 500, 200, 5000, 4000]) {
      s.clockRef.t = t;
      expect(
        s.mutate({}, (tx) => tx.log({ entity: 'setting', entityId: 's', op: 'update' })).ok,
      ).toBe(true);
    }
    const rows = readRows(s.changelog.read({ limit: 100 }));
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const hlcs = rows.map((r) => r.hlc);
    expect(hlcs).toEqual([...hlcs].toSorted());
    expect(new Set(hlcs).size).toBe(7);
  });

  it('HLC survives a restart (persisted in meta)', () => {
    const d = tmp();
    const p = join(d, 'n.db');
    const a = open(p, { clock: { now: () => 9000 } });
    a.mutate({}, (tx) => tx.log({ entity: 'setting', entityId: 's', op: 'update' }));
    a.close();
    const b = open(p, { clock: { now: () => 100 } }); // wall clock went far back
    b.mutate({}, (tx) => tx.log({ entity: 'setting', entityId: 's', op: 'update' }));
    const rows = readRows(b.changelog.read({ limit: 10 }));
    expect(rows[1]!.hlc > rows[0]!.hlc).toBe(true);
    expect(rows[1]!.seq).toBe(2);
  });

  it('purge writes a tombstone per listed id; trash writes none; untag-style update writes none', () => {
    const s = make();
    s.mutate({}, (tx) => tx.log({ entity: 'note', entityId: N1, op: 'trash' }));
    s.mutate({}, (tx) =>
      tx.log({
        entity: 'note_tag',
        entityId: `${N1}:${T1}`,
        op: 'update',
        fields: { present: false },
      }),
    );
    expect(s.db.prepare('SELECT count(*) AS n FROM tombstones').get()).toEqual({ n: 0 });
    const r = s.mutate({}, (tx) =>
      tx.log({
        entity: 'folder',
        entityId: F1,
        op: 'purge',
        purged: [
          { entity: 'folder', id: F1 },
          { entity: 'note', id: N1 },
          { entity: 'note', id: N2 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    const ts = s.db
      .prepare('SELECT entity_id, entity, change_id FROM tombstones ORDER BY entity_id')
      .all();
    expect(ts).toHaveLength(3);
    const row = readRows(s.changelog.read({ limit: 10 })).at(-1)!;
    expect(row.purgedIds).toEqual([
      { entity: 'folder', id: F1 },
      { entity: 'note', id: N1 },
      { entity: 'note', id: N2 },
    ]);
    // the tombstones carry the entity type too
    expect(ts.map((t) => (t as { entity: string }).entity)).toEqual(['folder', 'note', 'note']);
    expect(ts.every((t) => (t as { change_id: string }).change_id === row.id)).toBe(true);
    // tag merge: tombstone for the tag id only, carrying merged_into
    s.mutate({}, (tx) => tx.log({ entity: 'tag', entityId: T9, op: 'purge', mergedInto: T1 }));
    expect(
      s.db.prepare(`SELECT merged_into FROM tombstones WHERE entity_id='${T9}'`).get(),
    ).toEqual({
      merged_into: T1,
    });
    // purged ids are only legal on purge
    const bad = s.mutate({}, (tx) =>
      tx.log({ entity: 'note', entityId: N2, op: 'trash', purged: [{ entity: 'note', id: N2 }] }),
    );
    expect(bad.ok).toBe(false);
  });

  it('is append-only; the only allowed UPDATE is redacting fields', () => {
    const s = make();
    s.mutate({}, (tx) =>
      tx.log({ entity: 'note', entityId: N1, op: 'update', fields: { title: 'secret' } }),
    );
    expect(() => s.db.prepare('DELETE FROM change_log').run()).toThrow(/append-only/);
    expect(() => s.db.prepare("UPDATE change_log SET op = 'purge'").run()).toThrow(/append-only/);
    expect(() => s.db.prepare("UPDATE change_log SET fields = '{}'").run()).toThrow(/append-only/);
    expect(() => s.db.prepare('UPDATE change_log SET fields = NULL, seq = 9').run()).toThrow(
      /append-only/,
    );
    s.mutate({}, (tx) => {
      redactFields(tx.db, [N1]);
      return tx.log({ entity: 'note', entityId: N1, op: 'purge' });
    });
    const rows = readRows(s.changelog.read({ limit: 10 }));
    expect(rows[0]).toMatchObject({ entityId: N1, fields: null, seq: 1 });
  });

  it('CAS: expectedContentHash mismatch is a conflict and writes nothing', () => {
    const s = make();
    const cur = sha256('current');
    const r = s.mutate({ expectedContentHash: sha256('stale') }, (tx) => {
      const c = tx.checkExpected(cur);
      return c.ok ? tx.log({ entity: 'note', entityId: N2, op: 'update' }) : c;
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(count(s)).toBe(0);
    expect(s.mutate({ expectedContentHash: cur }, (tx) => tx.checkExpected(cur)).ok).toBe(true);
  });

  it('rejects a malformed context', () => {
    const s = make();
    expect(s.mutate({ actor: '' }, () => ({ ok: true, value: 1 }))).toMatchObject({ ok: false });
  });

  it('readChanges skips what the caller already has, per device', () => {
    const s = make();
    for (let i = 0; i < 3; i++)
      s.mutate({}, (tx) => tx.log({ entity: 'setting', entityId: 's', op: 'update' }));
    expect(
      readRows(s.changelog.read({ afterDeviceSeq: { [s.deviceId]: 2 }, limit: 10 })),
    ).toHaveLength(1);
    expect(readRows(s.changelog.read({ afterDeviceSeq: { other: 99 }, limit: 10 }))).toHaveLength(
      3,
    );
    expect(readRows(s.changelog.read({ limit: 2 }))).toHaveLength(2);
  });
});

const U = (n: number) => `01HF7YAT00${String(n).padStart(16, '0')}`; // a valid ULID per number
const PEER = U(900);
// A device's hlc rises with its seq (applyRemote refuses otherwise); seq 1 keeps the historical value.
const hlcOf = (seq: number) => `000001700000000-${String(6 + seq).padStart(10, '0')}`;
const rem = (over: Partial<RemoteChange> = {}): RemoteChange => ({
  id: U(1),
  entity: 'note',
  entityId: U(2),
  op: 'update',
  hlc: hlcOf(over.seq ?? 1),
  deviceId: PEER,
  seq: 1,
  actorId: null,
  schemaVersion: MIGRATIONS.length,
  fields: { title: 'from peer' },
  contentHash: sha256('x'),
  createdAt: 1,
  ...over,
});
/** Applies `n` consecutive rows from one peer, as sync does. */
const feed = (s: Store, n: number, deviceId = PEER) => {
  for (let i = 1; i <= n; i++)
    expect(
      s.changelog.applyRemote(rem({ id: U(100 + i), deviceId, seq: i, entityId: U(50 + i) })).ok,
    ).toBe(true);
};
const hlcMeta = (s: Store) =>
  s.db.prepare("SELECT key, value FROM meta WHERE key LIKE 'hlc_%' ORDER BY key").all();

describe('applyRemote (echo prevention)', () => {
  it('stores the remote row verbatim, adds no local row, takes no local seq', () => {
    const s = make();
    s.mutate({}, (tx) => tx.log({ entity: 'setting', entityId: 'a', op: 'update' }));
    const localBefore = count(s, "origin='local'");
    let applied = 0;
    const r = s.changelog.applyRemote(rem(), () => {
      applied++;
      return { ok: true, value: undefined };
    });
    expect(r).toEqual({ ok: true, value: true });
    expect(applied).toBe(1);
    expect(count(s, "origin='local'")).toBe(localBefore);
    expect(count(s, "origin='remote'")).toBe(1);
    expect(
      s.db.prepare("SELECT device_id, seq, hlc FROM change_log WHERE origin='remote'").get(),
    ).toEqual({ device_id: PEER, seq: 1, hlc: rem().hlc });
    // the next local action continues the local sequence, unaffected by the remote row
    s.mutate({}, (tx) => tx.log({ entity: 'setting', entityId: 'a', op: 'update' }));
    expect(
      readRows(s.changelog.read({ afterDeviceSeq: { [PEER]: 1 }, limit: 10 })).map((x) => [
        x.deviceId,
        x.seq,
      ]),
    ).toEqual([
      [s.deviceId, 1],
      [s.deviceId, 2],
    ]);
  });

  // M1: replaces the old assertion "takes no local HLC tick" (meta unchanged), which was the bug.
  it('M1: merges the remote HLC into the local clock without a seq or a local row', () => {
    const c = { t: 1_700_000_000_000 };
    const s = make(c);
    s.mutate({}, (tx) => tx.log({ entity: 'setting', entityId: 'a', op: 'update' }));
    const fast = `${String(c.t + 600_000).padStart(15, '0')}-0000000003`; // peer clock 10 min fast
    expect(s.changelog.applyRemote(rem({ hlc: fast }))).toEqual({ ok: true, value: true });
    expect(hlcMeta(s)).toEqual([
      { key: 'hlc_counter', value: '3' },
      { key: 'hlc_ms', value: String(c.t + 600_000) },
    ]);
    expect(count(s, "origin='local'")).toBe(1);
    // a slower remote hlc never moves the clock back
    expect(
      s.changelog.applyRemote(
        rem({ id: U(3), deviceId: U(901), seq: 1, hlc: '000001700000000-0000000009' }),
      ).ok,
    ).toBe(true);
    expect(hlcMeta(s)[1]).toEqual({ key: 'hlc_ms', value: String(c.t + 600_000) });
    // a later local edit sorts after the applied remote edit, although the wall clock is behind it
    s.mutate({}, (tx) => tx.log({ entity: 'setting', entityId: 'a', op: 'update' }));
    const rows = readRows(s.changelog.read({ limit: 10 }));
    const local = rows.filter((x) => x.origin === 'local').at(-1)!;
    expect(local.hlc > fast).toBe(true);
    expect(local.seq).toBe(2);
  });

  it('is idempotent on (device_id, seq), refuses its own device id, and rolls back with a failed effect', () => {
    const s = make();
    expect(s.changelog.applyRemote(rem()).ok).toBe(true);
    expect(s.changelog.applyRemote(rem())).toEqual({ ok: true, value: false });
    expect(count(s)).toBe(1);
    expect(s.changelog.applyRemote(rem({ deviceId: s.deviceId, seq: 1 }))).toMatchObject({
      ok: false,
    });
    const f = s.changelog.applyRemote(rem({ id: U(5), seq: 2 }), () => ({
      ok: false,
      error: { code: 'conflict', message: 'x' },
    }));
    expect(f.ok).toBe(false);
    expect(count(s)).toBe(1);
  });

  it('a remote purge keeps its explicit id list and tombstones every id, with entity types', () => {
    const s = make();
    s.changelog.applyRemote(
      rem({
        op: 'purge',
        entity: 'folder',
        entityId: U(10),
        purgedIds: [
          { entity: 'folder', id: U(10) },
          { entity: 'note', id: U(11) },
        ],
        fields: null,
      }),
    );
    expect(
      s.db.prepare('SELECT entity_id, entity FROM tombstones ORDER BY entity_id').all(),
    ).toEqual([
      { entity_id: U(10), entity: 'folder' },
      { entity_id: U(11), entity: 'note' },
    ]);
  });

  // M3
  it('M3: the applyEntity callback cannot write a local log row', () => {
    const s = make();
    let seen: unknown;
    const r = s.changelog.applyRemote(rem(), (tx) => {
      seen = tx.log({ entity: 'note', entityId: U(2), op: 'update' });
      return { ok: true, value: undefined };
    });
    expect(seen).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(r).toEqual({ ok: true, value: true });
    expect(count(s, "origin='local'")).toBe(0);
  });

  // M2
  it('M2: two devices purge the same note and each applies the other purge row', () => {
    const a = make();
    const b = make();
    const note = U(20);
    const purge = (s: Store) =>
      s.mutate({}, (tx) =>
        tx.log({
          entity: 'note',
          entityId: note,
          op: 'purge',
          purged: [{ entity: 'note', id: note }],
        }),
      );
    expect(purge(a).ok && purge(b).ok).toBe(true);
    const toRemote = (s: Store): RemoteChange => {
      const r = readRows(s.changelog.read({ limit: 10 })).at(-1)!;
      const rest: Record<string, unknown> = { ...r };
      delete rest.origin;
      return rest as RemoteChange;
    };
    const [fromA, fromB] = [toRemote(a), toRemote(b)]; // before either applies the other's row
    expect(a.changelog.applyRemote(fromB)).toEqual({ ok: true, value: true });
    expect(b.changelog.applyRemote(fromA)).toEqual({ ok: true, value: true });
    expect(a.db.prepare('SELECT count(*) AS n FROM tombstones').get()).toEqual({ n: 1 });
    expect(count(a, "origin='remote'")).toBe(1);
  });

  it('M2: a later purge fills in a tombstone whose entity was unknown', () => {
    const s = make();
    s.db
      .prepare(
        'INSERT INTO tombstones(entity_id, entity, purged_at, change_id) VALUES (?,NULL,1,?)',
      )
      .run(U(30), U(31));
    s.mutate({}, (tx) =>
      tx.log({
        entity: 'note',
        entityId: U(30),
        op: 'purge',
        purged: [{ entity: 'note', id: U(30) }],
      }),
    );
    expect(s.db.prepare('SELECT entity, change_id FROM tombstones').all()).toEqual([
      { entity: 'note', change_id: U(31) },
    ]);
  });

  describe('M4 trust boundary', () => {
    const invalid = (s: Store, over: Partial<RemoteChange>) =>
      expect(s.changelog.applyRemote(rem(over))).toMatchObject({
        ok: false,
        error: { code: 'validation' },
      });

    it('rejects malformed ids, hashes, hlc, enums and unknown keys', () => {
      const s = make();
      invalid(s, { id: 'not-a-ulid' });
      invalid(s, { deviceId: 'PEER' });
      invalid(s, { entityId: 'N1' });
      invalid(s, { entity: 'note_tag', entityId: U(2) });
      invalid(s, { contentHash: 'abc' });
      invalid(s, { baseContentHash: 'Z'.repeat(64) });
      invalid(s, { noteVersionId: 'v1' });
      invalid(s, { hlc: '1-2' });
      invalid(s, { op: 'nuke' as never });
      invalid(s, { entity: 'secret' as never });
      invalid(s, { extra: 1 } as never);
      expect(count(s)).toBe(0);
    });

    it('forbids note text in fields and caps the size', () => {
      const s = make();
      invalid(s, { fields: { body: 'full note text' } });
      invalid(s, { fields: { text: 'x' } });
      invalid(s, { fields: { title: 'x'.repeat(70_000) } });
      expect(s.changelog.applyRemote(rem({ fields: { title: 'x'.repeat(60_000) } })).ok).toBe(true);
    });

    it('a remote purge redacts the fields of earlier rows for the purged ids (and their note_tag rows)', () => {
      const s = make();
      const note = U(40);
      const tag = U(41);
      expect(
        s.changelog.applyRemote(
          rem({ id: U(42), entityId: note, seq: 1, fields: { title: 'secret title' } }),
        ).ok,
      ).toBe(true);
      expect(
        s.changelog.applyRemote(
          rem({
            id: U(43),
            entity: 'note_tag',
            entityId: `${note}:${tag}`,
            seq: 2,
            fields: { present: true },
          }),
        ).ok,
      ).toBe(true);
      s.mutate({}, (tx) =>
        tx.log({ entity: 'note', entityId: note, op: 'update', fields: { title: 'local secret' } }),
      );
      expect(
        s.changelog.applyRemote(
          rem({
            id: U(44),
            op: 'purge',
            entityId: note,
            seq: 3,
            fields: null,
            purgedIds: [{ entity: 'note', id: note }],
          }),
        ).ok,
      ).toBe(true);
      const live = s.db
        .prepare('SELECT count(*) AS n FROM change_log WHERE fields IS NOT NULL AND op <> ?')
        .get('purge') as { n: number };
      expect(live.n).toBe(0);
    });

    it('sequence reuse with a different payload is a conflict; the identical row stays a no-op', () => {
      const s = make();
      expect(s.changelog.applyRemote(rem()).ok).toBe(true);
      expect(s.changelog.applyRemote(rem())).toEqual({ ok: true, value: false });
      const diffId = s.changelog.applyRemote(rem({ id: U(77) }));
      expect(diffId).toMatchObject({ ok: false, error: { code: 'conflict' } });
      expect(!diffId.ok && diffId.error.message).toMatch(/sequence reuse/);
      const diffHash = s.changelog.applyRemote(rem({ contentHash: sha256('other') }));
      expect(!diffHash.ok && diffHash.error.message).toMatch(/sequence reuse/);
      // redaction of fields does not make the same row look different
      s.db.prepare('UPDATE change_log SET fields = NULL').run();
      expect(s.changelog.applyRemote(rem())).toEqual({ ok: true, value: false });
      expect(count(s)).toBe(1);
    });

    it('a per-device sequence gap is a conflict; the first row must be seq 1', () => {
      const s = make();
      const first = s.changelog.applyRemote(rem({ seq: 2 }));
      expect(first).toMatchObject({ ok: false, error: { code: 'conflict' } });
      expect(!first.ok && first.error.message).toMatch(/sequence gap/);
      feed(s, 2);
      const gap = s.changelog.applyRemote(rem({ id: U(88), seq: 4 }));
      expect(!gap.ok && gap.error.message).toMatch(/sequence gap/);
      expect(count(s)).toBe(2);
      // other devices are independent
      expect(s.changelog.applyRemote(rem({ id: U(89), deviceId: U(901), seq: 1 }))).toEqual({
        ok: true,
        value: true,
      });
    });
  });
});
