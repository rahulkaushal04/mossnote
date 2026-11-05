import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeAttachFs } from '../../src/attachments/fsport.ts';
import { blobPathIn } from '../../src/attachments/scan.ts';
import { backupName, libraryDir, listLibrary } from '../../src/portability/library.ts';
import { verifyPackageFile } from '../../src/portability/backup.ts';
import { PortError } from '../../src/portability/errors.ts';
import { padFor, parseHeader } from '../../src/portability/tar.ts';
import { createBackupScheduler } from '../../src/portability/schedule.ts';
import { tmp } from '../store/helpers.ts';
import { faultFs } from '../attachments/util.ts';
import { openFx, must, PNG, seed, sha, T0, FAST_CRYPTO, type Fx } from './util.ts';

const HOUR = 3_600_000;

async function withAttachment(f: Fx): Promise<string> {
  const { noteIds } = seed(f.w, 3);
  const ref = must(await f.w.attachments.addFromBytes({}, noteIds[0]!, PNG, 'pic.png'));
  return ref.sha256;
}
/** Byte offsets of each tar entry's data, found by walking the headers. */
function layout(buf: Buffer): { name: string; header: number; data: number; size: number }[] {
  const out: { name: string; header: number; data: number; size: number }[] = [];
  let pos = 0;
  for (;;) {
    const h = parseHeader(buf.subarray(pos, pos + 512));
    if (h === 'end') return out;
    out.push({ name: h.name, header: pos, data: pos + 512, size: h.size });
    pos += 512 + h.size + padFor(h.size);
  }
}
const corrupt = async (p: Promise<unknown>) => {
  let thrown: unknown;
  try {
    await p;
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(PortError);
};

describe('backup (PT-6, PT-9, C2)', () => {
  it('writes one .mossbak with the fixed entry order, lists it valid, and leaves no temp files', async () => {
    const f = openFx();
    const sh = await withAttachment(f);
    const r = must(await f.w.portability.backup({ kind: 'manual' }));
    expect(r).toMatchObject({ verified: true, noteCount: 3, attachments: 1, damaged: [], encrypted: false });
    const list = f.w.portability.library.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: r.id, kind: 'manual', valid: true, restorable: true, encrypted: false, noteCount: 3 });
    expect(list[0]!.id).toMatch(/^backup-\d{8}T\d{6}Z-manual-[0-9A-Z]{26}\.mossbak$/);
    const buf = readFileSync(r.path);
    expect(layout(buf).map((e) => e.name)).toEqual(['mossnote.db', `attachments/${sh}`, 'mossnote-backup.json', 'mossnote-backup.sha256']);
    expect(readdirSync(libraryDir(f.path)).filter((n) => n.endsWith('.tmp') || n.startsWith('.snap'))).toEqual([]);
    expect(readdirSync(f.dir).filter((n) => n.startsWith('.'))).toEqual([]);
    const v = must(await f.w.portability.verify(r.id));
    expect(v.damaged).toBe(0);
  });

  it('every part is hash-checked: a flipped byte in db, attachment, manifest or trailer is refused', async () => {
    const f = openFx();
    await withAttachment(f);
    const r = must(await f.w.portability.backup({ kind: 'manual' }));
    const good = readFileSync(r.path);
    const parts = layout(good);
    expect(parts).toHaveLength(4);
    const dir = tmp();
    for (const p of parts) {
      for (const at of [p.data, p.data + Math.floor(p.size / 2), p.data + p.size - 1]) {
        const bad = Buffer.from(good);
        bad[at]! ^= 0x01;
        const file = join(dir, `bad-${p.name.replace('/', '_')}-${at}`);
        writeFileSync(file, bad);
        await corrupt(verifyPackageFile(file));
      }
    }
    const first = join(dir, 'good');
    writeFileSync(first, good);
    await expect(verifyPackageFile(first)).resolves.toMatchObject({ manifest: { noteCount: 3 } });
  });

  it('truncated, reordered and padded packages are refused', async () => {
    const f = openFx();
    await withAttachment(f);
    const r = must(await f.w.portability.backup({ kind: 'manual' }));
    const good = readFileSync(r.path);
    const parts = layout(good);
    const chunk = (e: (typeof parts)[number]) => good.subarray(e.header, e.data + e.size + padFor(e.size));
    const end = Buffer.alloc(1024);
    const dir = tmp();
    const t = (name: string, b: Buffer) => {
      const p = join(dir, name);
      writeFileSync(p, b);
      return p;
    };
    await corrupt(verifyPackageFile(t('trunc1', good.subarray(0, good.length - 700))));
    await corrupt(verifyPackageFile(t('trunc2', good.subarray(0, Math.floor(good.length / 2)))));
    await corrupt(verifyPackageFile(t('noend', good.subarray(0, good.length - 1024))));
    // trailer before manifest
    await corrupt(verifyPackageFile(t('order', Buffer.concat([chunk(parts[0]!), chunk(parts[1]!), chunk(parts[3]!), chunk(parts[2]!), end]))));
    // db after the attachment
    await corrupt(verifyPackageFile(t('order2', Buffer.concat([chunk(parts[1]!), chunk(parts[0]!), chunk(parts[2]!), chunk(parts[3]!), end]))));
    // an extra, unlisted entry
    const extra = Buffer.concat([Buffer.from('x')]);
    const { tarHeader } = await import('../../src/portability/tar.ts');
    const entry = Buffer.concat([tarHeader('attachments/' + 'f'.repeat(64), 1), extra, Buffer.alloc(511)]);
    await corrupt(verifyPackageFile(t('extra', Buffer.concat([chunk(parts[0]!), chunk(parts[1]!), entry, chunk(parts[2]!), chunk(parts[3]!), end]))));
    // an unknown name
    const unknown = Buffer.concat([tarHeader('evil.txt', 1), extra, Buffer.alloc(511)]);
    await corrupt(verifyPackageFile(t('unknown', Buffer.concat([chunk(parts[0]!), chunk(parts[1]!), unknown, chunk(parts[2]!), chunk(parts[3]!), end]))));
    // a duplicate of the attachment entry
    await corrupt(verifyPackageFile(t('dup', Buffer.concat([chunk(parts[0]!), chunk(parts[1]!), chunk(parts[1]!), chunk(parts[2]!), chunk(parts[3]!), end]))));
  });

  it('a truncated package in the library is listed invalid; .tmp files are ignored', async () => {
    const f = openFx();
    seed(f.w, 2);
    const r = must(await f.w.portability.backup({ kind: 'manual' }));
    const dir = libraryDir(f.path);
    const good = readFileSync(r.path);
    const name = backupName(T0 + 5000, 'manual', 'T'.repeat(26));
    writeFileSync(join(dir, name), good.subarray(0, good.length - 1500));
    writeFileSync(join(dir, `${name}.tmp`), good);
    writeFileSync(join(dir, 'notes.txt'), 'x');
    const list = listLibrary(f.path);
    expect(list.map((b) => [b.id, b.valid])).toEqual([[name, false], [r.id, true]]);
  });

  it('C2: a rotted attachment is recorded as damaged, the backup is still written and restorable', async () => {
    const f = openFx();
    const sh = await withAttachment(f);
    writeFileSync(blobPathIn(f.w.attachments.root, sh), Buffer.concat([PNG, Buffer.from('ROT')]));
    const r = must(await f.w.portability.backup({ kind: 'manual' }));
    expect(r.damaged).toEqual([{ sha256: sh, reason: 'corrupt' }]);
    const verified = await verifyPackageFile(r.path);
    expect(verified.manifest.damaged).toEqual([{ sha256: sh, reason: 'corrupt' }]);
    expect(verified.manifest.attachments).toEqual([]);
    expect(f.w.portability.library.list()[0]).toMatchObject({ valid: true, damaged: 1 });
    // a missing file has no entry at all
    const f2 = openFx();
    const sh2 = await withAttachment(f2);
    const { unlinkSync } = await import('node:fs');
    unlinkSync(blobPathIn(f2.w.attachments.root, sh2));
    const r2 = must(await f2.w.portability.backup({ kind: 'manual' }));
    expect(r2.damaged).toEqual([{ sha256: sh2, reason: 'missing' }]);
    expect(layout(readFileSync(r2.path)).map((e) => e.name)).toEqual(['mossnote.db', 'mossnote-backup.json', 'mossnote-backup.sha256']);
  });

  it('retention: keeps the newest N auto backups, never manual ones, and only prunes after a CLEAN newer backup', async () => {
    const f = openFx();
    const sh = await withAttachment(f);
    must(f.w.portability.settings.set({ auto: true, intervalHours: 24, keep: 2 }));
    const manual = must(await f.w.portability.backup({ kind: 'manual' }));
    for (let i = 0; i < 4; i++) {
      f.clock.t += HOUR;
      must(await f.w.portability.backup({ kind: 'auto' }));
    }
    let list = f.w.portability.library.list();
    expect(list.filter((b) => b.kind === 'auto')).toHaveLength(2);
    expect(list.some((b) => b.id === manual.id)).toBe(true);
    const cleanNewest = list.find((b) => b.kind === 'auto')!.id;
    // The attachment rots: the next backups are damaged and must not cause deletions.
    writeFileSync(blobPathIn(f.w.attachments.root, sh), Buffer.from('rotted'));
    f.clock.t += HOUR;
    const bad = must(await f.w.portability.backup({ kind: 'auto' }));
    expect(bad.damaged).toHaveLength(1);
    list = f.w.portability.library.list();
    expect(list.filter((b) => b.kind === 'auto')).toHaveLength(3); // nothing pruned
    expect(list.some((b) => b.id === cleanNewest)).toBe(true);
    expect(list.filter((b) => b.kind === 'auto' && b.damaged === 0).length).toBeGreaterThanOrEqual(1);
  });

  it('PT-10: passphrase backup round trip; wrong or missing passphrase and tampering are refused', async () => {
    const f = openFx();
    seed(f.w, 5);
    const dir = tmp();
    const file = join(dir, 'secret.mossbak');
    const r = must(await f.w.portability.backup({ kind: 'manual', file, passphrase: 'correct horse battery' }));
    expect(r).toMatchObject({ encrypted: true, noteCount: 5 });
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 7).toString()).toBe('MOSSBAK');
    expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false);
    expect(bytes.includes(Buffer.from('correct horse'))).toBe(false);
    await expect(verifyPackageFile(file, 'correct horse battery')).resolves.toMatchObject({ manifest: { noteCount: 5 } });
    await corrupt(verifyPackageFile(file));
    await corrupt(verifyPackageFile(file, 'wrong passphrase'));
    const bad = Buffer.from(bytes);
    bad[Math.floor(bytes.length / 2)]! ^= 1;
    const badFile = join(dir, 'bad.mossbak');
    writeFileSync(badFile, bad);
    await corrupt(verifyPackageFile(badFile, 'correct horse battery'));
    writeFileSync(join(dir, 'cut.mossbak'), bytes.subarray(0, bytes.length - 100));
    await corrupt(verifyPackageFile(join(dir, 'cut.mossbak'), 'correct horse battery'));
    // not stored anywhere in the workspace folder or the database
    for (const n of readdirSync(f.dir)) {
      const p = join(f.dir, n);
      if (existsSync(p) && !readdirSync(f.dir, { withFileTypes: true }).find((e) => e.name === n)?.isDirectory())
        expect(readFileSync(p).includes(Buffer.from('correct horse battery'))).toBe(false);
    }
    expect(f.w.portability.library.list().some((b) => b.encrypted)).toBe(false); // file backups are not in the library
  });

  it('PT-12: disk full and permission errors give a typed message, no final file, no temp', async () => {
    for (const [code, msg] of [['ENOSPC', /disk space/i], ['EACCES', /permission/i]] as const) {
      const ff = faultFs();
      const f = openFx({ portability: { fs: ff.fs } });
      seed(f.w, 3);
      ff.failOnWrite(2, code);
      const dir = tmp();
      const file = join(dir, 'out.mossbak');
      const r = await f.w.portability.backup({ kind: 'manual', file });
      expect(r).toMatchObject({ ok: false, error: { code: 'io' } });
      expect(!r.ok && r.error.message).toMatch(msg);
      expect(readdirSync(dir)).toEqual([]);
      expect(readdirSync(libraryDir(f.path)).filter((n) => n.startsWith('.snap'))).toEqual([]);
    }
    // rename fails
    const f = openFx({
      portability: { fs: { ...nodeAttachFs, rename: () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); } } },
    });
    const dir = tmp();
    const r = await f.w.portability.backup({ kind: 'manual', file: join(dir, 'o.mossbak') });
    expect(r).toMatchObject({ ok: false, error: { code: 'io' } });
    expect(readdirSync(dir)).toEqual([]);
    // free space check
    const g = openFx({ portability: { fs: { ...nodeAttachFs, freeBytes: () => 1000 } } });
    const full = await g.w.portability.backup({ kind: 'manual' });
    expect(full).toMatchObject({ ok: false, error: { code: 'io' } });
    expect(listLibrary(g.path)).toEqual([]);
  });

  it('refuses a relative target path and an existing-file-less cancelled run leaves nothing', async () => {
    const f = openFx();
    seed(f.w, 1);
    expect(await f.w.portability.backup({ kind: 'manual', file: 'relative.mossbak' })).toMatchObject({ ok: false, error: { code: 'validation' } });
    const ac = new AbortController();
    ac.abort();
    const r = await f.w.portability.backup({ kind: 'manual', signal: ac.signal });
    expect(r.ok).toBe(false);
    expect(listLibrary(f.path)).toEqual([]);
  });

  it('copyFile keeps tests honest: a copy of a good package verifies from anywhere', async () => {
    const f = openFx();
    seed(f.w, 1);
    const r = must(await f.w.portability.backup({ kind: 'manual' }));
    const dir = tmp();
    mkdirSync(join(dir, 'x'));
    copyFileSync(r.path, join(dir, 'x', 'c.mossbak'));
    expect((await verifyPackageFile(join(dir, 'x', 'c.mossbak'))).dbSha).toMatch(/^[0-9a-f]{64}$/);
    expect(sha(readFileSync(r.path))).toBe(sha(readFileSync(join(dir, 'x', 'c.mossbak'))));
    void FAST_CRYPTO;
  });
});

describe('auto-backup scheduler (PT-7)', () => {
  function rig(over: { last?: number; settings?: { auto: boolean; intervalHours: number; keep: number } } = {}) {
    const st = { now: T0, last: over.last ?? 0, runs: 0, warns: [] as string[], timers: [] as { fn: () => void; ms: number }[], settings: over.settings ?? { auto: true, intervalHours: 24, keep: 7 }, fail: false };
    const s = createBackupScheduler({
      now: () => st.now,
      setTimer: (fn, ms) => {
        const t = { fn, ms };
        st.timers.push(t);
        return t;
      },
      clearTimer: (h) => void (st.timers = st.timers.filter((t) => t !== h)),
      settings: () => st.settings,
      lastAutoAt: () => st.last,
      run: async () => {
        st.runs++;
        if (st.fail) return { ok: false, message: 'disk full' };
        st.last = st.now;
        return { ok: true };
      },
      onWarn: (m) => st.warns.push(m),
    });
    return { st, s };
  }
  it('first check after 10 minutes, runs only when the interval elapsed, then hourly', async () => {
    const { st, s } = rig({ last: T0 - 2 * HOUR });
    s.start();
    expect(st.timers.map((t) => t.ms)).toEqual([10 * 60_000]);
    await s.tick(); // 2 h since the last backup: not due
    expect(st.runs).toBe(0);
    st.now = T0 + 21 * HOUR; // 23 h since the last backup
    await s.tick();
    expect(st.runs).toBe(0);
    st.now = T0 + 22 * HOUR; // exactly 24 h
    await s.tick();
    expect(st.runs).toBe(1);
    await s.stop();
  });
  it('a future last-backup stamp (clock skew) counts as due; disabled never runs; an interval change applies', async () => {
    const a = rig({ last: T0 + 99 * HOUR });
    a.s.start();
    await a.s.tick();
    expect(a.st.runs).toBe(1);
    const b = rig({ last: 0, settings: { auto: false, intervalHours: 24, keep: 7 } });
    b.s.start();
    await b.s.tick();
    expect(b.st.runs).toBe(0);
    const c = rig({ last: T0 - 2 * HOUR });
    c.s.start();
    await c.s.tick();
    expect(c.st.runs).toBe(0);
    c.st.settings = { auto: true, intervalHours: 1, keep: 7 };
    await c.s.tick();
    expect(c.st.runs).toBe(1);
    for (const r of [a, b, c]) await r.s.stop();
  });
  it('a failing run warns and is retried at the next check; stop() clears timers and waits', async () => {
    const { st, s } = rig();
    st.fail = true;
    s.start();
    await s.tick();
    expect(st.warns).toEqual(['disk full']);
    st.fail = false;
    await s.tick();
    expect(st.runs).toBe(2);
    await s.stop();
    await s.tick();
    expect(st.runs).toBe(2);
  });
  it('integration: a workspace scheduler writes a real auto backup through the job mutex', async () => {
    const timers: (() => void)[] = [];
    const f = openFx({ portability: { setTimer: (fn) => (timers.push(fn), timers.length), clearTimer: () => undefined } });
    seed(f.w, 2);
    f.w.portability.scheduler.start();
    expect(timers).toHaveLength(1);
    timers.shift()!();
    await f.w.portability.drain();
    expect(f.w.portability.library.list().map((b) => b.kind)).toEqual(['auto']);
    expect(f.w.store.db.prepare("SELECT value FROM meta WHERE key='backup_last_auto_at'").get()).toEqual({ value: String(T0) });
  });
});
