/* eslint-disable @typescript-eslint/no-explicit-any -- test replies are untyped JSON */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPTURE_METHODS, createDispatcher, methods, type Dispatcher, type RpcEvent, type RpcResult } from '../../src/rpc/index.ts';
import { applyPendingRestore } from '../../src/portability/restore.ts';
import { openWorkspace } from '../../src/workspace.ts';
import { tmp } from '../store/helpers.ts';
import { FAST_CRYPTO, must as mustR, write, T0 } from '../portability/util.ts';

const open: Dispatcher[] = [];
afterEach(() => {
  for (const d of open.splice(0)) d.close();
});
const code = (r: RpcResult<unknown>) => (r.ok ? 'ok' : r.error.code);

function setup(picks: { exportDir?: string | null; importDir?: string | null; save?: string | null; open?: string | null } = {}) {
  const dir = tmp();
  const dbPath = join(dir, 'w.db');
  const r = openWorkspace(dbPath, { attachments: { pdf: null }, portability: { crypto: FAST_CRYPTO }, clock: { now: () => T0 } });
  const restarts: number[] = [];
  const asked: string[] = [];
  const d = createDispatcher(r, {
    platform: 'test',
    dbPath,
    pickExportDir: async () => (asked.push('export'), picks.exportDir ?? null),
    pickImportDir: async () => (asked.push('import'), picks.importDir ?? null),
    pickBackupSavePath: async (name) => (asked.push(`save:${name}`), picks.save ?? null),
    pickBackupOpenPath: async () => (asked.push('open'), picks.open ?? null),
    restartForRestore: () => void restarts.push(1),
  });
  open.push(d);
  const events: RpcEvent[] = [];
  d.onEvent((e) => events.push(e));
  const call = async (m: unknown, a: unknown = {}) => {
    const reply = await d.handle(m, a);
    structuredClone(reply);
    return reply;
  };
  const val = async <T = any>(m: string, a: unknown = {}): Promise<T> => {
    const x = await call(m, a);
    if (!x.ok) throw new Error(`${m}: ${x.error.code} ${x.error.message}`);
    return x.value as T;
  };
  const finalJob = async (jobId: string) => {
    await d.drain();
    const e = events.filter((x): x is Extract<RpcEvent, { type: 'job' }> => x.type === 'job' && x.jobId === jobId).at(-1);
    return e!;
  };
  return { dir, dbPath, ws: mustR(r), d, events, call, val, finalJob, restarts, asked };
}
const PORT = Object.keys(methods).filter((m) => m.startsWith('portability.') || m.startsWith('bulk.'));

describe('portability RPC surface', () => {
  it('is exactly the agreed list and none of it is a capture method', () => {
    expect([...PORT].sort()).toEqual(
      ['portability.status', 'portability.setSchedule', 'portability.exportStart', 'portability.importStart', 'portability.backupNow', 'portability.backupList', 'portability.backupVerify', 'portability.restoreStart', 'bulk.move', 'bulk.tag', 'bulk.trash', 'bulk.untrash', 'bulk.export'].sort(),
    );
    for (const m of PORT) expect(CAPTURE_METHODS).not.toContain(m);
  });

  it('strict schemas: no paths, extra keys, bad bounds or a passphrase with the library target', async () => {
    const { call } = setup();
    const cases: [string, unknown][] = [
      ['portability.exportStart', { scope: { kind: 'all' }, path: '/tmp/x' }],
      ['portability.exportStart', { scope: { kind: 'all', dir: '/tmp' } }],
      ['portability.exportStart', { scope: { kind: 'notes', ids: [] } }],
      ['portability.exportStart', { scope: { kind: 'notes', ids: Array.from({ length: 100_001 }, (_, i) => `n${i}`) } }],
      ['portability.exportStart', {}],
      ['portability.importStart', { dir: '/tmp' }],
      ['portability.importStart', { path: '/tmp' }],
      ['portability.backupNow', { to: 'file', path: '/tmp/x.mossbak' }],
      ['portability.backupNow', { to: 'library', passphrase: 'long enough passphrase' }],
      ['portability.backupNow', { to: 'file', passphrase: 'short' }],
      ['portability.backupNow', { to: 'file', passphrase: 'x'.repeat(1025) }],
      ['portability.backupNow', { to: 'cloud' }],
      ['portability.backupVerify', { id: '' }],
      ['portability.backupVerify', { id: 'x'.repeat(201) }],
      ['portability.restoreStart', { source: { path: '/tmp/x' } }],
      ['portability.restoreStart', { source: { id: 'a', file: true } }],
      ['portability.restoreStart', { source: { file: false } }],
      ['portability.restoreStart', { source: { id: 'a' }, extra: 1 }],
      ['portability.setSchedule', { auto: true, intervalHours: 0, keep: 7 }],
      ['portability.setSchedule', { auto: true, intervalHours: 24, keep: 101 }],
      ['portability.setSchedule', { auto: 'yes', intervalHours: 24, keep: 7 }],
      ['bulk.move', { items: [] }],
      ['bulk.move', { items: [{ id: 'a', folderId: null, extra: 1 }] }],
      ['bulk.move', { items: Array.from({ length: 10_001 }, (_, i) => ({ id: `n${i}`, folderId: null })) }],
      ['bulk.tag', { ids: ['a'], tagId: 'b' }],
      ['bulk.tag', { ids: [], tagId: 'b', on: true }],
      ['bulk.trash', { ids: Array.from({ length: 10_001 }, (_, i) => `n${i}`) }],
      ['bulk.trash', { ids: ['a'], extra: true }],
      ['bulk.untrash', { batchIds: [] }],
      ['bulk.export', { ids: [] }],
      ['bulk.export', { ids: ['a'], dir: '/tmp' }],
    ];
    for (const [m, a] of cases) expect(code(await call(m, a)), `${m} ${JSON.stringify(a).slice(0, 60)}`).toBe('validation');
  });

  it('exportStart: main picks the folder, a job runs with progress and a final result event, replies survive structured clone', async () => {
    const out = tmp();
    const s = setup({ exportDir: out });
    s.ws.notes.create({}, { title: 'One', body: 'x' });
    const started = await s.val('portability.exportStart', { scope: { kind: 'all' } });
    expect(started).toEqual({ jobId: expect.any(String) });
    const last = await s.finalJob(started.jobId);
    expect(last).toMatchObject({ kind: 'export', phase: 'done', result: { kind: 'export', notes: 1, folderName: 'Mossnote export 2023-11-14' } });
    expect(last.error).toBeUndefined();
    expect(JSON.stringify(last)).not.toContain(out); // no path leaves main
    expect(readdirSync(out)).toEqual(['Mossnote export 2023-11-14']);
    for (const e of s.events) structuredClone(e);
    expect((await s.val('portability.status')).lastJob).toMatchObject({ kind: 'export', ok: true });
  });

  it('a cancelled dialog is {cancelled:true}; a missing hook is unavailable; a bad dialog result is refused', async () => {
    const s = setup({ exportDir: null });
    expect(await s.val('portability.exportStart', { scope: { kind: 'all' } })).toEqual({ cancelled: true });
    expect(await s.val('portability.importStart')).toEqual({ cancelled: true });
    expect(await s.val('portability.backupNow', { to: 'file' })).toEqual({ cancelled: true });
    expect(await s.val('portability.restoreStart', { source: { file: true } })).toEqual({ cancelled: true });
    expect(s.asked).toEqual(['export', 'import', expect.stringMatching(/^save:Mossnote backup 2023-11-14\.mossbak$/), 'open']);
    const d2 = createDispatcher(openWorkspace(join(tmp(), 'w.db'), { attachments: { pdf: null } }), { pickExportDir: async () => 'relative/path' });
    open.push(d2);
    expect(code(await d2.handle('portability.exportStart', { scope: { kind: 'all' } }))).toBe('internal');
    expect(code(await d2.handle('portability.importStart', {}))).toBe('unavailable');
  });

  it('a second job while one runs is unavailable; the dispatcher drains on quit', async () => {
    const out = tmp();
    const s = setup({ exportDir: out });
    for (let i = 0; i < 3; i++) s.ws.notes.create({}, { title: `n${i}`, body: 'x' });
    // Both calls start before either dialog resolves: the backup takes the slot, the export is refused.
    const pa = s.call('portability.exportStart', { scope: { kind: 'all' } });
    const pb = s.call('portability.backupNow', { to: 'library' });
    expect(code(await pb)).toBe('ok');
    expect(code(await pa)).toBe('unavailable');
    await s.d.drain();
    expect((await s.val('portability.status')).job).toBeUndefined();
    expect(readdirSync(out)).toEqual([]);
  });

  it('backupNow library + list + verify; backup to a chosen file with a passphrase; the passphrase never appears in events or status', async () => {
    const dest = join(tmp(), 'secret.mossbak');
    const s = setup({ save: dest });
    s.ws.notes.create({}, { title: 'n', body: 'x' });
    const lib = await s.val('portability.backupNow', { to: 'library' });
    const libLast = await s.finalJob(lib.jobId);
    expect(libLast.result).toMatchObject({ kind: 'backup', verified: true, damaged: 0, encrypted: false, noteCount: 1 });
    const list = await s.val<any[]>('portability.backupList');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'manual', valid: true, restorable: true });
    expect(JSON.stringify(list)).not.toContain(s.dir);
    expect(await s.val('portability.backupVerify', { id: list[0].id })).toMatchObject({ ok: true, damaged: 0, noteCount: 1 });
    expect(code(await s.call('portability.backupVerify', { id: '../w.db' }))).toBe('not_found');

    const pass = 'a very secret passphrase';
    const enc = await s.val('portability.backupNow', { to: 'file', passphrase: pass });
    const encLast = await s.finalJob(enc.jobId);
    expect(encLast.result).toMatchObject({ kind: 'backup', encrypted: true });
    expect(readFileSync(dest).subarray(0, 7).toString()).toBe('MOSSBAK');
    expect(JSON.stringify(s.events)).not.toContain(pass);
    expect(JSON.stringify(await s.val('portability.status'))).not.toContain(pass);
    expect(s.asked.some((a) => a.includes(pass))).toBe(false);
  });

  it('restoreStart by id stages the restore, reports restartRequired and asks desktop to restart; applying it at startup restores', async () => {
    const s = setup();
    const keep = s.ws.notes.create({}, { title: 'kept', body: 'x' });
    expect(keep.ok).toBe(true);
    const b = await s.val('portability.backupNow', { to: 'library' });
    await s.finalJob(b.jobId);
    s.ws.notes.create({}, { title: 'after backup', body: 'y' });
    const id = (await s.val<any[]>('portability.backupList'))[0].id;
    expect(code(await s.call('portability.restoreStart', { source: { id: 'nope.mossbak' } }))).toBe('ok'); // the job starts, then fails
    await s.d.drain();
    expect((await s.val('portability.status')).lastJob).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const r = await s.val('portability.restoreStart', { source: { id } });
    const last = await s.finalJob(r.jobId);
    expect(last.result).toMatchObject({ kind: 'restore', restartRequired: true, noteCount: 1, damaged: 0 });
    await new Promise((res) => setImmediate(res));
    expect(s.restarts).toHaveLength(1);
    expect((await s.val('portability.status')).restorePending).toBe(true);
    s.d.close();
    expect(mustR(applyPendingRestore(s.dbPath))).toMatchObject({ applied: true });
    const w = mustR(openWorkspace(s.dbPath, { attachments: { pdf: null } }));
    expect((w.store.db.prepare('SELECT count(*) AS n FROM notes').get() as { n: number }).n).toBe(1);
    w.close();
  });

  it('importStart picks a folder in main, runs, reports, and resumes a pending import without asking for a folder', async () => {
    const src = tmp();
    write(src, 'a.md', '# A\nx');
    write(src, 'sub/b.md', '# B\ny');
    const s = setup({ importDir: src });
    const st = await s.val('portability.importStart');
    const last = await s.finalJob(st.jobId);
    expect(last.result).toMatchObject({ kind: 'import', added: 2, skipped: 0, resumed: false, folderName: 'Imported 2023-11-14' });
    expect(s.events.some((e) => e.type === 'changed' && e.entity === 'note')).toBe(true);
    expect((await s.val('notes.list', {})).length).toBe(2);
    expect((await s.val('portability.status')).pendingImport).toBe(false);
  });

  it('bulk methods round trip through the dispatcher and emit changed events', async () => {
    const s = setup();
    const a = (await s.val('notes.create', { body: 'a' })).id;
    const b = (await s.val('notes.create', { body: 'b' })).id;
    const t = await s.val('bulk.trash', { ids: [a, b] });
    expect(t.batchIds).toHaveLength(2);
    expect((await s.val('notes.list', {})).length).toBe(0);
    expect(await s.val('bulk.untrash', { batchIds: t.batchIds })).toMatchObject({ restored: 2, skipped: 0 });
    expect((await s.val('notes.list', {})).length).toBe(2);
    const f = await s.val('folders.create', { name: 'F' });
    const mv = await s.val('bulk.move', { items: [{ id: a, folderId: f.id }, { id: b, folderId: f.id }] });
    expect(mv.previous).toHaveLength(2);
    const tag = await s.val('tags.create', { name: 't' });
    expect(await s.val('bulk.tag', { ids: [a, b], tagId: tag.id, on: true })).toMatchObject({ changed: [a, b] });
    expect(code(await s.call('bulk.trash', { ids: [a, 'missing'] }))).toBe('not_found');
    expect((await s.val('notes.list', {})).length).toBe(2); // all or nothing
    expect(s.events.filter((e) => e.type === 'changed' && e.entity === 'trash').length).toBeGreaterThanOrEqual(2);
  });

  it('setSchedule persists and status reports it', async () => {
    const s = setup();
    expect((await s.val('portability.status')).schedule).toEqual({ auto: true, intervalHours: 24, keep: 7 });
    await s.val('portability.setSchedule', { auto: false, intervalHours: 6, keep: 3 });
    expect((await s.val('portability.status')).schedule).toEqual({ auto: false, intervalHours: 6, keep: 3 });
  });

  it('recovery mode: a corrupt workspace still lists backups and restores by id; nothing else works', async () => {
    const s = setup();
    s.ws.notes.create({}, { title: 'n', body: 'x' });
    const b = await s.val('portability.backupNow', { to: 'library' });
    await s.finalJob(b.jobId);
    s.d.close();
    writeFileSync(s.dbPath, Buffer.alloc(8192, 9));
    const events: RpcEvent[] = [];
    const restarts: number[] = [];
    const r = openWorkspace(s.dbPath, { attachments: { pdf: null } });
    expect(r).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    const d = createDispatcher(r, { restartForRestore: () => void restarts.push(1) });
    d.onEvent((e) => events.push(e));
    open.push(d);
    expect(code(await d.handle('notes.list', {}))).toBe('corrupt');
    expect(code(await d.handle('portability.exportStart', { scope: { kind: 'all' } }))).toBe('corrupt');
    expect(code(await d.handle('portability.backupNow', { to: 'library' }))).toBe('corrupt');
    const list = (await d.handle('portability.backupList', {})) as any;
    expect(list.value).toHaveLength(1);
    const started = (await d.handle('portability.restoreStart', { source: { id: list.value[0].id } })) as any;
    expect(started.ok).toBe(true);
    await d.drain();
    const fin = events.filter((e) => e.type === 'job').at(-1) as any;
    expect(fin.result).toMatchObject({ kind: 'restore', restartRequired: true });
    await new Promise((res) => setImmediate(res));
    expect(restarts).toHaveLength(1);
    d.close();
    mustR(applyPendingRestore(s.dbPath));
    const w = mustR(openWorkspace(s.dbPath, { attachments: { pdf: null } }));
    expect((w.store.db.prepare('SELECT count(*) AS n FROM notes').get() as { n: number }).n).toBe(1);
    w.close();
  });
});
