import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blobPathIn } from '../../src/attachments/scan.ts';
import { createLibrary } from '../../src/portability/index.ts';
import { JOURNAL, applyPendingRestore, pendingRestoreExists } from '../../src/portability/restore.ts';
import { padFor, parseHeader, tarHeader } from '../../src/portability/tar.ts';
import { MIGRATIONS, V2 } from '../store/helpers.ts';
import { openWorkspace } from '../../src/workspace.ts';
import { tmp } from '../store/helpers.ts';
import { closeFx, count, openFx, must, PNG, seed, sha, T0, type Fx } from './util.ts';

const CRASH = Object.assign(new Error('simulated crash'), {}); // no .code: the engine must let it through

async function fixture(extraAfterBackup = 4) {
  const f = openFx();
  const { noteIds } = seed(f.w, 6);
  const ref = must(await f.w.attachments.addFromBytes({}, noteIds[0]!, PNG, 'pic.png'));
  must(f.w.notes.update({}, noteIds[1]!, { title: 'zebra note', body: 'a unique zebra word' }));
  const backup = must(await f.w.portability.backup({ kind: 'manual' }));
  const oldDevice = f.w.store.deviceId;
  for (let i = 0; i < extraAfterBackup; i++) must(f.w.notes.create({}, { title: `later ${i}`, body: 'later' }));
  return { f, backup, noteIds, att: ref.sha256, oldDevice };
}
const hashLive = (f: Fx) => sha(readFileSync(f.path));
const asides = (dir: string) => readdirSync(dir).filter((n) => n.startsWith('pre-restore-')).sort();
const leftovers = (dir: string) => readdirSync(dir).filter((n) => n.startsWith('.restore-') || n === JOURNAL || n === `${JOURNAL}.tmp`);

describe('verified restore (PT-8, C1)', () => {
  it('stages without touching live data, swaps at startup, rotates the device, marks search dirty, keeps the old data aside', async () => {
    const { f, backup, oldDevice, att } = await fixture();
    expect(count(f.w, 'notes')).toBe(10);
    const before = hashLive(f);
    const staged = must(await f.w.portability.restore({ id: backup.id }));
    expect(staged).toMatchObject({ noteCount: 6, damaged: 0 });
    expect(hashLive(f)).toBe(before); // live untouched while staging
    expect(pendingRestoreExists(f.path)).toBe(true);
    expect(readdirSync(f.dir).some((n) => n.startsWith('.restore-'))).toBe(true);
    // a second restore while one is pending is refused
    expect(await f.w.portability.restore({ id: backup.id })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    // the app must restart: opening now is refused (no empty workspace is ever created)
    const dir = f.dir;
    const livePath = f.path;
    closeFx(f);
    expect(openWorkspace(livePath)).toMatchObject({ ok: false, error: { code: 'unavailable' } });

    const applied = must(applyPendingRestore(livePath, { clock: { now: () => T0 } }));
    expect(applied.applied).toBe(true);
    expect(leftovers(dir)).toEqual([]);
    const aside = asides(dir);
    expect(aside).toHaveLength(1);
    expect(existsSync(join(dir, aside[0]!, 'w.db'))).toBe(true);
    expect(existsSync(join(dir, `w.db-wal`))).toBe(false);

    const w = must(openWorkspace(livePath, { attachments: { pdf: null } }));
    try {
      expect(count(w, 'notes')).toBe(6);
      expect(w.store.deviceId).not.toBe(oldDevice);
      expect(w.store.db.prepare("SELECT value FROM meta WHERE key='sync_full_reconcile'").get()).toEqual({ value: '1' });
      expect(must(w.search.status())).toMatchObject({ state: 'dirty' });
      must(w.search.rebuild());
      expect(must(w.search.status())).toMatchObject({ state: 'ready' });
      expect(must(w.search.search({ query: 'zebra' })).hits).toHaveLength(1);
      expect(must(w.search.search({ query: 'later' })).hits).toHaveLength(0); // brute force agrees: those notes are gone
      expect(must(w.search.verify()).ok).toBe(true);
      expect(w.store.db.pragma('integrity_check', { simple: true })).toBe('ok');
      // the attachment came back and verifies
      expect(must(await w.attachments.verifyAll())).toMatchObject({ checked: 1, ok: 1 });
      expect(existsSync(blobPathIn(join(dir, 'attachments'), att))).toBe(true);
    } finally {
      w.close();
    }
  });

  it('a flipped byte in any part is refused, the stage is removed and live data is untouched', async () => {
    const { f, backup } = await fixture();
    const buf = readFileSync(join(f.dir, 'backups', backup.id));
    const parts: { name: string; data: number; size: number }[] = [];
    for (let pos = 0; ; ) {
      const h = parseHeader(buf.subarray(pos, pos + 512));
      if (h === 'end') break;
      parts.push({ name: h.name, data: pos + 512, size: h.size });
      pos += 512 + h.size + padFor(h.size);
    }
    const before = hashLive(f);
    const listing = readdirSync(f.dir).sort();
    const src = join(tmp(), 'tampered.mossbak');
    for (const p of parts) {
      const bad = Buffer.from(buf);
      bad[p.data + Math.floor(p.size / 2)]! ^= 0x01;
      writeFileSync(src, bad);
      const r = await f.w.portability.restore({ file: src });
      expect(r).toMatchObject({ ok: false });
      expect(hashLive(f)).toBe(before);
      expect(readdirSync(f.dir).sort()).toEqual(listing);
      expect(pendingRestoreExists(f.path)).toBe(false);
    }
    // truncated file too
    writeFileSync(src, buf.subarray(0, buf.length - 3000));
    expect((await f.w.portability.restore({ file: src })).ok).toBe(false);
    expect(readdirSync(f.dir).sort()).toEqual(listing);
  });

  it('refuses ids that are not in the library, paths in ids, and non-files', async () => {
    const { f } = await fixture();
    for (const id of ['../w.db', 'nope.mossbak', '', 'backup-20240101T000000Z-auto-AAAAAAAAAAAAAAAAAAAAAAAAAA.mossbak'])
      expect(await f.w.portability.restore({ id })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await f.w.portability.restore({ file: f.dir })).toMatchObject({ ok: false });
    expect(leftovers(f.dir)).toEqual([]);
  });

  it('an encrypted backup restores only with the right passphrase; a wrong one leaves no stage', async () => {
    const f = openFx();
    seed(f.w, 4);
    const file = join(tmp(), 'enc.mossbak');
    must(await f.w.portability.backup({ kind: 'manual', file, passphrase: 'a long passphrase' }));
    const listing = readdirSync(f.dir).sort();
    expect(await f.w.portability.restore({ file })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await f.w.portability.restore({ file }, 'wrong passphrase')).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(readdirSync(f.dir).sort()).toEqual(listing);
    expect(must(await f.w.portability.restore({ file }, 'a long passphrase')).noteCount).toBe(4);
  });

  it('a backup from a newer schema is refused ("newer Mossnote")', async () => {
    const dir = tmp();
    const path = join(dir, 'w.db');
    const w2 = must(openWorkspace(path, { migrations: [...MIGRATIONS, V2], attachments: { pdf: null } }));
    must(w2.notes.create({}, { title: 'x', body: 'y' }));
    const file = join(tmp(), 'newer.mossbak');
    must(await w2.portability.backup({ kind: 'manual', file }));
    w2.close();
    const f = openFx();
    const r = await f.w.portability.restore({ file });
    expect(r).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(!r.ok && r.error.message).toMatch(/newer Mossnote/);
    expect(leftovers(f.dir)).toEqual([]);
  });

  it('M7: a validly signed package whose manifest disagrees with the database attachments is refused', async () => {
    const { f, backup } = await fixture();
    const buf = readFileSync(join(f.dir, 'backups', backup.id));
    const parts: { header: number; end: number; data: number; size: number; name: string }[] = [];
    for (let pos = 0; ; ) {
      const h = parseHeader(buf.subarray(pos, pos + 512));
      if (h === 'end') break;
      const end = pos + 512 + h.size + padFor(h.size);
      parts.push({ header: pos, end, data: pos + 512, size: h.size, name: h.name });
      pos = end;
    }
    const dbPart = parts.find((p) => p.name === 'mossnote.db')!;
    const mf = parts.find((p) => p.name === 'mossnote-backup.json')!;
    const manifest = JSON.parse(buf.subarray(mf.data, mf.data + mf.size).toString('utf8')) as { attachments: unknown[] };
    expect(manifest.attachments).toHaveLength(1);
    manifest.attachments = []; // consistent with the (dropped) entries, but the database still has the row
    const mb = Buffer.from(JSON.stringify(manifest));
    const trailer = Buffer.from(`${sha(mb)} ${mb.length}\n`, 'latin1');
    const pkg = Buffer.concat([
      buf.subarray(dbPart.header, dbPart.end),
      tarHeader('mossnote-backup.json', mb.length),
      mb,
      Buffer.alloc(padFor(mb.length)),
      tarHeader('mossnote-backup.sha256', trailer.length),
      trailer,
      Buffer.alloc(padFor(trailer.length)),
      Buffer.alloc(1024),
    ]);
    const file = join(tmp(), 'inconsistent.mossbak');
    writeFileSync(file, pkg);
    const r = await f.w.portability.restore({ file });
    expect(r).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    expect(!r.ok && r.error.message).toMatch(/attachments/);
    expect(leftovers(f.dir)).toEqual([]);
  });

  it('C2: restoring a backup with a damaged attachment works and marks that attachment', async () => {
    const f = openFx();
    const { noteIds } = seed(f.w, 3);
    const ref = must(await f.w.attachments.addFromBytes({}, noteIds[0]!, PNG, 'pic.png'));
    writeFileSync(blobPathIn(f.w.attachments.root, ref.sha256), Buffer.from('rotted bytes'));
    const b = must(await f.w.portability.backup({ kind: 'manual' }));
    expect(b.damaged).toHaveLength(1);
    expect(must(await f.w.portability.restore({ id: b.id }))).toMatchObject({ damaged: 1, noteCount: 3 });
    const livePath = f.path;
    const dir = f.dir;
    closeFx(f);
    must(applyPendingRestore(livePath));
    const w = must(openWorkspace(livePath, { attachments: { pdf: null } }));
    try {
      expect(count(w, 'notes')).toBe(3);
      expect(w.store.db.prepare('SELECT verify_state FROM attachments WHERE sha256 = ?').get(ref.sha256)).toEqual({ verify_state: 'corrupt' });
      expect(existsSync(blobPathIn(join(dir, 'attachments'), ref.sha256))).toBe(false);
    } finally {
      w.close();
    }
  });

  it('keeps only the last two pre-restore folders', async () => {
    const f = openFx();
    seed(f.w, 2);
    const b = must(await f.w.portability.backup({ kind: 'manual' }));
    const dir = f.dir;
    const livePath = f.path;
    closeFx(f);
    let t = T0;
    for (let i = 0; i < 3; i++) {
      t += 5000;
      const w = must(openWorkspace(livePath, { clock: { now: () => t }, attachments: { pdf: null } }));
      must(w.notes.create({}, { title: `extra ${i}`, body: 'x' }));
      must(await w.portability.restore({ id: b.id }));
      w.close();
      must(applyPendingRestore(livePath, { clock: { now: () => t } }));
    }
    expect(asides(dir)).toHaveLength(2);
  });

  it('WAL/SHM leftovers move aside first and never end up next to the restored database', async () => {
    const { f, backup } = await fixture();
    const livePath = f.path;
    const dir = f.dir;
    must(await f.w.portability.restore({ id: backup.id }));
    closeFx(f);
    writeFileSync(`${livePath}-wal`, 'stale wal from the old database');
    writeFileSync(`${livePath}-shm`, 'stale shm');
    const order: string[] = [];
    must(applyPendingRestore(livePath, { onStep: (l) => void order.push(l) }));
    expect(order.filter((l) => l.startsWith('move:')).slice(0, 3)).toEqual(['move:w.db-wal', 'move:w.db-shm', 'move:w.db']);
    const aside = asides(dir)[0]!;
    expect(readFileSync(join(dir, aside, 'w.db-wal'), 'utf8')).toBe('stale wal from the old database');
    expect(existsSync(`${livePath}-wal`)).toBe(false);
    const w = must(openWorkspace(livePath, { attachments: { pdf: null } }));
    expect(count(w, 'notes')).toBe(6);
    w.close();
  });

  it('a damaged staged database is discarded before any move; live data stays', async () => {
    const { f, backup } = await fixture();
    const livePath = f.path;
    const dir = f.dir;
    must(await f.w.portability.restore({ id: backup.id }));
    closeFx(f);
    const live = hashLive({ path: livePath } as Fx);
    const stage = readdirSync(dir).find((n) => n.startsWith('.restore-'))!;
    const sdb = join(dir, stage, 'mossnote.db');
    const bytes = readFileSync(sdb);
    bytes[bytes.length - 50]! ^= 1;
    writeFileSync(sdb, bytes);
    const r = must(applyPendingRestore(livePath));
    expect(r).toMatchObject({ applied: false });
    expect(r.discarded).toMatch(/checksum/);
    expect(hashLive({ path: livePath } as Fx)).toBe(live);
    expect(leftovers(dir)).toEqual([]);
    expect(asides(dir)).toEqual([]);
  });

  it('C1: a crash (or kill) at EVERY journal step still ends in the restored data, and the live data is never lost on the way', async () => {
    // Record the steps once.
    const probe = await fixture();
    must(await probe.f.w.portability.restore({ id: probe.backup.id }));
    const probePath = probe.f.path;
    closeFx(probe.f);
    const steps: string[] = [];
    must(applyPendingRestore(probePath, { onStep: (l) => void steps.push(l) }));
    expect(steps.length).toBeGreaterThanOrEqual(7);
    expect(steps).toContain('journal-swapping');
    expect(steps).toContain('verify');
    expect(steps).toContain('journal-delete');

    for (let k = 0; k < steps.length; k++) {
      const { f, backup } = await fixture(3);
      must(await f.w.portability.restore({ id: backup.id }));
      const livePath = f.path;
      const dir = f.dir;
      closeFx(f);
      const original = hashLive({ path: livePath } as Fx);
      let n = 0;
      let crashed = false;
      try {
        applyPendingRestore(livePath, {
          onStep: () => {
            if (n++ === k) throw CRASH;
          },
        });
      } catch (e) {
        crashed = e === CRASH;
      }
      expect(crashed).toBe(true);
      // Live data is somewhere: in place, or in the aside folder.
      const aside = asides(dir);
      const where = [livePath, ...aside.map((a) => join(dir, a, 'w.db'))].filter((p) => existsSync(p));
      expect(where.some((p) => sha(readFileSync(p)) === original), `step ${k} (${steps[k]}) lost the live database`).toBe(true);
      // Restart: the journal is replayed.
      expect(() => must(applyPendingRestore(livePath))).not.toThrow();
      expect(leftovers(dir)).toEqual([]);
      const w = must(openWorkspace(livePath, { attachments: { pdf: null } }));
      expect(count(w, 'notes'), `step ${k} (${steps[k]})`).toBe(6);
      expect(w.store.db.pragma('integrity_check', { simple: true })).toBe('ok');
      w.close();
    }
  });

  it('C1: a restored database that fails verification after the moves is rolled back, not replaced by an empty workspace', async () => {
    const { f, backup } = await fixture(2);
    must(await f.w.portability.restore({ id: backup.id }));
    const livePath = f.path;
    const dir = f.dir;
    closeFx(f);
    const original = hashLive({ path: livePath } as Fx);
    let crashed = false;
    try {
      applyPendingRestore(livePath, {
        onStep: (l) => {
          if (l === 'verify') throw CRASH;
        },
      });
    } catch (e) {
      crashed = e === CRASH;
    }
    expect(crashed).toBe(true);
    const bytes = readFileSync(livePath); // the placed database rots before the replay
    bytes[bytes.length - 50]! ^= 1;
    writeFileSync(livePath, bytes);
    const r = must(applyPendingRestore(livePath));
    expect(r.applied).toBe(false);
    expect(hashLive({ path: livePath } as Fx)).toBe(original);
    expect(leftovers(dir)).toEqual([]);
    const w = must(openWorkspace(livePath, { attachments: { pdf: null } }));
    expect(count(w, 'notes')).toBe(8);
    w.close();
  });

  it('openWorkspace never creates a database while a journal exists, even if the live file is gone', async () => {
    const { f, backup } = await fixture(1);
    must(await f.w.portability.restore({ id: backup.id }));
    const livePath = f.path;
    closeFx(f);
    rmSync(livePath);
    expect(openWorkspace(livePath)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(existsSync(livePath)).toBe(false);
    must(applyPendingRestore(livePath));
    expect(existsSync(livePath)).toBe(true);
  });

  it('an unreadable or tampered journal is never acted on and never deleted', async () => {
    const f = openFx();
    seed(f.w, 1);
    const livePath = f.path;
    const dir = f.dir;
    closeFx(f);
    const jp = join(dir, JOURNAL);
    writeFileSync(jp, '{not json');
    expect(applyPendingRestore(livePath)).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    expect(existsSync(jp)).toBe(true);
    writeFileSync(
      jp,
      JSON.stringify({ v: 1, phase: 'swapping', stage: '.restore-' + 'A'.repeat(26), db: 'w.db', att: 'attachments', verified: 'a'.repeat(64), aside: 'pre-restore-20240101T000000Z', moves: [{ from: 'w.db', to: '../../elsewhere' }] }),
    );
    expect(applyPendingRestore(livePath).ok).toBe(false);
    expect(existsSync(livePath)).toBe(true);
    writeFileSync(jp, JSON.stringify({ v: 1, phase: 'staged', stage: '../evil', db: 'w.db', att: 'attachments', verified: 'a'.repeat(64) }));
    expect(applyPendingRestore(livePath)).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    expect(existsSync(livePath)).toBe(true);
  });

  it('recovery mode: with a corrupt database the library still lists and restores a backup by id', async () => {
    const { f, backup } = await fixture(0);
    const livePath = f.path;
    const dir = f.dir;
    closeFx(f);
    writeFileSync(livePath, Buffer.alloc(8192, 7)); // destroyed
    rmSync(`${livePath}-wal`, { force: true });
    const lib = createLibrary({ dbPath: livePath });
    expect(lib.list().map((b) => b.id)).toEqual([backup.id]);
    expect(await lib.stageRestore({ id: '../../etc/passwd' })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await lib.verify(backup.id)).toMatchObject({ ok: true });
    must(await lib.stageRestore({ id: backup.id }));
    must(applyPendingRestore(livePath));
    const w = must(openWorkspace(livePath, { attachments: { pdf: null } }));
    expect(count(w, 'notes')).toBe(6);
    w.close();
    expect(asides(dir)).toHaveLength(1); // the corrupt database is kept aside (CS-9)
  });
});
