import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { RemoteChange } from '../../src/changelog/apply.ts';
import { sha256 } from '../../src/db/hash.ts';
import { openDb } from '../../src/db/open.ts';
import type { Db } from '../../src/db/types.ts';
import { formatHlc, tickHlc } from '../../src/ids/hlc.ts';
import { err, ok } from '../../src/result.ts';
import { APPLICATION_ID, openStore } from '../../src/store/store.ts';
import { openWorkspace } from '../../src/workspace.ts';
import { open, tmp } from '../store/helpers.ts';
import { unwrap } from '../notes/util.ts';

const U = (c: string) => c.repeat(26);
const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const hlcAt = (ms: number, c = 0) => formatHlc({ ms, counter: c });
const rem = (over: Partial<RemoteChange> = {}): RemoteChange => ({
  id: U('C'),
  entity: 'setting',
  entityId: 'x',
  op: 'update',
  hlc: hlcAt(T0),
  deviceId: U('B'),
  seq: 1,
  schemaVersion: 1,
  fields: {},
  createdAt: 0,
  ...over,
});
const make = () => open(join(tmp(), 'n.db'), { clock: { now: () => T0 } });
const log = (s: ReturnType<typeof make>) =>
  s.mutate({}, (tx) => tx.log({ entity: 'setting', entityId: 'y', op: 'update' }));

describe('B1 HLC cannot be bricked by a remote row', () => {
  it('refuses an HLC more than an hour ahead of the store clock; accepts 59 minutes', () => {
    const s = make();
    const far = s.changelog.applyRemote(rem({ hlc: '999999999999999-9999999999' }));
    expect(far).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(!far.ok && far.error.message).toMatch(/clock too far ahead/);
    expect(s.changelog.applyRemote(rem({ hlc: hlcAt(T0 + HOUR + 1) })).ok).toBe(false);
    expect(log(s).ok).toBe(true); // local writes still work
    const near = s.changelog.applyRemote(rem({ hlc: hlcAt(T0 + 59 * 60_000) }));
    expect(near).toEqual({ ok: true, value: true });
    expect(s.db.prepare("SELECT value FROM meta WHERE key='hlc_ms'").get()).toEqual({
      value: String(T0 + 59 * 60_000),
    });
  });

  it('a full counter carries into the next millisecond instead of throwing', () => {
    expect(tickHlc({ ms: 5, counter: 9_999_999_999 }, 1)).toEqual({ ms: 6, counter: 0 });
    const s = make();
    log(s);
    s.db.prepare("UPDATE meta SET value='9999999999' WHERE key='hlc_counter'").run();
    expect(log(s).ok).toBe(true);
    expect(log(s).ok).toBe(true);
    const hlcs = unwrap(s.changelog.read({ limit: 10 })).map((r) => r.hlc);
    expect([...hlcs].sort()).toEqual(hlcs);
  });
});

describe('Major 1 nested transaction safety', () => {
  it('a failed nested mutate does not roll back or commit the outer transaction', () => {
    const s = make();
    const ins = (k: string) =>
      s.db.prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, '1', 0)").run(k);
    // Observations are recorded and asserted after mutate returns: an expect() that throws
    // inside the callback would be caught by the transaction runner and silently pass.
    let innerOk: boolean | undefined;
    let stillInTx: boolean | undefined;
    const r = s.mutate({}, () => {
      ins('a');
      innerOk = s.mutate({}, () => ok(1)).ok; // BEGIN inside a tx fails
      stillInTx = s.db.inTransaction;
      ins('b');
      return err('internal', 'outer aborts');
    });
    expect(innerOk).toBe(false);
    expect(stillInTx).toBe(true);
    expect(r.ok).toBe(false);
    expect(s.db.prepare('SELECT key FROM settings').all()).toEqual([]);
  });
});

describe('Major 2 per-device HLC order', () => {
  it('refuses a row whose hlc does not exceed the device previous one', () => {
    const s = make();
    expect(s.changelog.applyRemote(rem({ hlc: hlcAt(5) })).ok).toBe(true);
    const bad = s.changelog.applyRemote(rem({ id: U('D'), seq: 2, hlc: hlcAt(1) }));
    expect(bad).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(!bad.ok && bad.error.message).toMatch(/hlc not increasing/);
    expect(
      s.changelog.applyRemote(rem({ id: U('D'), seq: 2, hlc: hlcAt(5) })).ok, // equal is not increasing
    ).toBe(false);
    expect(s.changelog.applyRemote(rem({ id: U('D'), seq: 2, hlc: hlcAt(6) })).ok).toBe(true);
  });

  it('read pages never yield a device seq out of order, even over legacy non-monotonic rows', () => {
    const s = make();
    s.changelog.applyRemote(rem({ hlc: hlcAt(5) }));
    s.changelog.applyRemote(rem({ id: U('D'), seq: 2, hlc: hlcAt(6) }));
    s.changelog.applyRemote(rem({ id: U('E'), seq: 3, hlc: hlcAt(7) }));
    s.db.exec('DROP TRIGGER change_log_redact_only'); // test-only: fabricate legacy bad data
    s.db.prepare('UPDATE change_log SET hlc = ? WHERE seq = 2').run(hlcAt(1)); // legacy bad data
    for (const limit of [1, 2]) {
      const seen: number[] = [];
      let after = 0;
      for (let i = 0; i < 5; i++) {
        const page = unwrap(
          s.changelog.read({ afterDeviceSeq: { [U('B')]: after }, limit }),
        ).filter((r) => r.deviceId === U('B'));
        for (const r of page) {
          seen.push(r.seq);
          after = r.seq;
        }
      }
      expect(seen).toEqual([1, 2, 3]);
    }
  });
});

describe('Major 3 drafts.flush keeps going past a failing note', () => {
  it('saves the other notes, drops the vanished one and reports it', () => {
    const p = join(tmp(), 'n.db');
    const w = unwrap(openWorkspace(p, { guards: [] }));
    const x = unwrap(w.notes.create({}, { title: 'x', body: '' }));
    const y = unwrap(w.notes.create({}, { title: 'y', body: '' }));
    w.drafts.write(x.id, 'typing in x', { rev: 1, contentHash: x.contentHash });
    w.drafts.write(y.id, 'unsaved y keystrokes', { rev: 1, contentHash: y.contentHash });
    w.store.db.prepare('DELETE FROM versions WHERE note_id=?').run(x.id);
    w.store.db.prepare('DELETE FROM notes WHERE id=?').run(x.id);
    const f = w.drafts.flush();
    expect(f).toMatchObject({ ok: false, error: { code: expect.any(String) } });
    expect(!f.ok && f.error.message).toContain(x.id);
    expect(w.drafts.flush()).toEqual({ ok: true, value: {} }); // x is not retried forever
    expect(w.close().ok).toBe(true);
    const w2 = unwrap(openWorkspace(p, { guards: [] }));
    expect(unwrap(w2.drafts.recover()).map((d) => d.body)).toEqual(['unsaved y keystrokes']);
    w2.close();
  });

  it('close persists the other notes text even when one note fails', () => {
    const p = join(tmp(), 'n.db');
    const w = unwrap(openWorkspace(p, { guards: [] }));
    const x = unwrap(w.notes.create({}, { title: 'x', body: '' }));
    const y = unwrap(w.notes.create({}, { title: 'y', body: '' }));
    w.drafts.write(x.id, 'xx', { rev: 1, contentHash: x.contentHash });
    w.drafts.write(y.id, 'yy', { rev: 1, contentHash: y.contentHash });
    w.store.db.prepare('DELETE FROM versions WHERE note_id=?').run(x.id);
    w.store.db.prepare('DELETE FROM notes WHERE id=?').run(x.id);
    expect(w.close().ok).toBe(false);
    const w2 = unwrap(openWorkspace(p, { guards: [] }));
    expect(unwrap(w2.drafts.recover()).map((d) => d.body)).toEqual(['yy']);
    w2.close();
  });
});

describe('Major 4 one schema for local and remote', () => {
  it('local appendChange refuses what applyRemote refuses', () => {
    const s = make();
    const bad = (
      c: Parameters<Parameters<typeof s.mutate>[1]>[0]['log'] extends (x: infer I) => unknown
        ? I
        : never,
    ) => s.mutate({}, (tx) => tx.log(c));
    expect(bad({ entity: 'note', entityId: 'N1', op: 'update' })).toMatchObject({ ok: false });
    expect(bad({ entity: 'setting', entityId: 'k'.repeat(129), op: 'update' })).toMatchObject({
      ok: false,
    });
    expect(
      bad({ entity: 'setting', entityId: 'k', op: 'update', fields: { v: 'x'.repeat(70_000) } }),
    ).toMatchObject({ ok: false });
    expect(
      bad({ entity: 'setting', entityId: 'k', op: 'update', fields: { text: 'x' } }),
    ).toMatchObject({ ok: false });
    expect(
      bad({ entity: 'note', entityId: U('1'), op: 'update', contentHash: 'abc' }),
    ).toMatchObject({ ok: false });
    expect(bad({ entity: 'setting', entityId: 'k'.repeat(128), op: 'update' }).ok).toBe(true);
    // and the remote side accepts that same row
    expect(s.changelog.applyRemote(rem({ entityId: 'k'.repeat(128) })).ok).toBe(true);
  });

  it('recordOnly records the row without the entity effect, so the next row applies', () => {
    const s = make();
    let calls = 0;
    const fail = () => (calls++, err('internal', 'permanent'));
    expect(s.changelog.applyRemote(rem(), fail).ok).toBe(false);
    expect(s.changelog.applyRemote(rem({ id: U('D'), seq: 2, hlc: hlcAt(T0 + 1) }), fail).ok).toBe(
      false,
    ); // gap
    expect(s.changelog.applyRemote(rem(), fail, { recordOnly: true })).toEqual({
      ok: true,
      value: true,
    });
    expect(calls).toBe(1);
    let applied = 0;
    const next = s.changelog.applyRemote(
      rem({ id: U('D'), seq: 2, hlc: hlcAt(T0 + 1) }),
      () => (applied++, ok(undefined)),
    );
    expect(next).toEqual({ ok: true, value: true });
    expect(applied).toBe(1);
  });
});

describe('minors', () => {
  it('a remote purge checkpoints the WAL and reports a busy checkpoint', () => {
    const warnings: string[] = [];
    const p = join(tmp(), 'n.db');
    const s = open(p, { clock: { now: () => T0 }, onWarning: (m) => warnings.push(m) });
    const reader = new Database(p);
    reader.exec('BEGIN');
    reader.prepare('SELECT count(*) FROM meta').get(); // holds a snapshot: TRUNCATE cannot finish
    s.mutate({}, () => ok(1));
    const note = U('7');
    expect(s.changelog.applyRemote(rem({ entity: 'note', entityId: note, op: 'purge' })).ok).toBe(
      true,
    );
    reader.close();
    expect(warnings.join()).toMatch(/checkpoint/);
    const quiet: string[] = [];
    const s2 = open(join(tmp(), 'm.db'), {
      clock: { now: () => T0 },
      onWarning: (m) => quiet.push(m),
    });
    expect(s2.changelog.applyRemote(rem({ entity: 'note', entityId: note, op: 'purge' })).ok).toBe(
      true,
    );
    expect(quiet).toEqual([]);
  });

  it('a duplicate change id under another (device, seq) is a conflict, not a SQLite error', () => {
    const s = make();
    expect(s.changelog.applyRemote(rem()).ok).toBe(true);
    const dup = s.changelog.applyRemote(rem({ deviceId: U('E') }));
    expect(dup).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(!dup.ok && dup.error.message).toMatch(/duplicate change id/);
  });

  it('close releases the lock even when db.close throws, and returns the error', () => {
    const p = join(tmp(), 'n.db');
    let boom = true;
    const wrap = (d: Db): Db => ({
      prepare: (sql) => d.prepare(sql),
      exec: (sql) => d.exec(sql),
      pragma: (src, o) => d.pragma(src, o),
      get inTransaction() {
        return d.inTransaction;
      },
      close() {
        if (boom) throw new Error('close failed');
        d.close();
      },
    });
    const a = openStore(p, { wrapDb: wrap });
    if (!a.ok) throw new Error(a.error.message);
    expect(a.value.close().ok).toBe(false);
    boom = false;
    const b = openStore(p);
    expect(b.ok).toBe(true); // lock was released
    if (b.ok) b.value.close();
  });

  it('openDb closes the raw handle when wrapDb throws', () => {
    let raw: { open: boolean } | undefined;
    expect(() =>
      openDb(join(tmp(), 'n.db'), {
        wrapDb: (d) => {
          raw = d as unknown as { open: boolean };
          throw new Error('wrap failed');
        },
      }),
    ).toThrow('wrap failed');
    expect(raw?.open).toBe(false);
  });

  it('refuses foreign SQLite files with user_version >= 1 and other application ids', () => {
    const mk = (setup: string) => {
      const p = join(tmp(), 'f.db');
      const d = new Database(p);
      d.exec(setup);
      d.close();
      return p;
    };
    const foreignV = mk('PRAGMA user_version = 1; CREATE TABLE t(x)');
    const foreignId = mk('PRAGMA application_id = 12345; CREATE TABLE t(x)');
    for (const p of [foreignV, foreignId]) {
      const r = openStore(p, { guards: [] });
      expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
      const d = new Database(p, { readonly: true });
      expect(d.pragma('journal_mode', { simple: true })).toBe('delete'); // untouched
      d.close();
    }
  });

  it('sets the application id on a fresh workspace and on an older dev database without one', () => {
    const p = join(tmp(), 'n.db');
    const a = open(p);
    expect(a.db.pragma('application_id', { simple: true })).toBe(APPLICATION_ID);
    a.close();
    const raw = new Database(p);
    raw.pragma('application_id = 0');
    raw.close();
    const b = open(p);
    expect(b.db.pragma('application_id', { simple: true })).toBe(APPLICATION_ID);
    expect(sha256('')).toBeTruthy();
  });
});
