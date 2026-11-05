/* eslint-disable @typescript-eslint/no-explicit-any -- test replies are untyped JSON */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '../../src/db/hash.ts';
import { ok, err } from '../../src/result.ts';
import { openWorkspace, type Workspace } from '../../src/workspace.ts';
import {
  methods,
  prefsSchema,
  createDispatcher,
  deriveTitle,
  type Dispatcher,
  type RpcEvent,
  type RpcResult,
} from '../../src/rpc/index.ts';

const dirs: string[] = [];
const open: Dispatcher[] = [];
afterEach(() => {
  for (const d of open.splice(0)) d.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mossnote-rpc-'));
  dirs.push(d);
  return d;
};

function setup() {
  const dir = tmp();
  const r = openWorkspace(join(dir, 'w.db'));
  if (!r.ok) throw new Error(r.error.message);
  const ws: Workspace = r.value;
  const d = createDispatcher(r, { platform: 'test' });
  open.push(d);
  const events: RpcEvent[] = [];
  d.onEvent((e) => events.push(e));
  const call = async (m: unknown, a: unknown = {}) => {
    const reply = await d.handle(m, a);
    structuredClone(reply); // every reply must survive IPC
    return reply;
  };
  const val = async <T = any>(m: string, a: unknown = {}): Promise<T> => {
    const r = await call(m, a);
    if (!r.ok) throw new Error(`${m}: ${r.error.code} ${r.error.message}`);
    return r.value as T;
  };
  return { dir, ws, d, events, call, val };
}
const code = (r: RpcResult<unknown>) => (r.ok ? 'ok' : r.error.code);

describe('method table', () => {
  it('matches the frozen list', () => {
    expect(Object.keys(methods).sort()).toEqual(
      [
        'app.status',
        'app.flushed',
        'app.quit',
        'app.openCapture',
        'drafts.flush',
        'notes.list',
        'notes.get',
        'notes.create',
        'notes.save',
        'notes.move',
        'notes.setFavorite',
        'notes.trash',
        'folders.list',
        'folders.create',
        'folders.rename',
        'folders.move',
        'folders.trash',
        'tags.list',
        'tags.create',
        'tags.rename',
        'tags.forNote',
        'tags.tagNote',
        'tags.untagNote',
        'trash.list',
        'trash.restore',
        'trash.purge',
        'drafts.write',
        'drafts.recover',
        'drafts.discard',
        'prefs.get',
        'prefs.set',
        'capture.save',
        'search.run',
        'search.status',
        'search.verify',
        'search.rebuild',
        'search.saved.list',
        'search.saved.create',
        'search.saved.rename',
        'search.saved.delete',
        'search.saved.reset',
        'attachments.addPath',
        'attachments.list',
        'attachments.remove',
        'attachments.info',
        'attachments.cleanupPreview',
        'attachments.cleanupRun',
        'attachments.verifyAll',
        'portability.status',
        'portability.setSchedule',
        'portability.exportStart',
        'portability.importStart',
        'portability.backupNow',
        'portability.backupList',
        'portability.backupVerify',
        'portability.restoreStart',
        'bulk.move',
        'bulk.tag',
        'bulk.trash',
        'bulk.untrash',
        'bulk.export',
      ].sort(),
    );
  });

  it('refuses prototype keys and non-strings', async () => {
    const { call } = setup();
    for (const m of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      'nope',
      '',
      1,
      null,
      {},
      ['notes.list'],
    ])
      expect(code(await call(m))).toBe('validation');
  });

  it('every method rejects unknown args (strict) and non-object args', async () => {
    const { call } = setup();
    for (const m of Object.keys(methods)) {
      expect(code(await call(m, { __extra: 1 })), m).toBe('validation');
      expect(code(await call(m, 'x')), m).toBe('validation');
      expect(code(await call(m, null)), m).toBe('validation');
    }
  });

  it('the renderer cannot smuggle ctx fields', async () => {
    const { call, val } = setup();
    const n = await val('notes.create', { body: 'a' });
    for (const extra of [{ actor: 'agent' }, { draftSeq: 99 }, { ctx: {} }])
      expect(
        code(
          await call('notes.save', {
            id: n.id,
            body: 'b',
            expectedContentHash: n.contentHash,
            ...extra,
          }),
        ),
      ).toBe('validation');
    expect(code(await call('notes.save', { id: n.id, body: 'b' }))).toBe('validation'); // hash required
  });
});

describe('errors', () => {
  it('strips cause and turns throws into internal', async () => {
    const { d, ws } = setup();
    // a failing core call that carries a cause: bad sqlite use via a closed-over db is hard; fake it.
    ws.notes.get = () => err('io', 'disk', new Error('/secret/path'));
    const r = await d.handle('notes.get', { id: 'x' });
    expect(r).toEqual({ ok: false, error: { code: 'io', message: 'disk' } });
    expect(JSON.stringify(r)).not.toContain('secret');
    ws.notes.get = () => {
      throw new Error('/secret/path boom');
    };
    const t = await d.handle('notes.get', { id: 'x' });
    expect(t).toEqual({ ok: false, error: { code: 'internal', message: 'internal error' } });
  });

  it('a failed workspace answers app.status and the open error to everything else', async () => {
    const d = createDispatcher(err('unavailable', 'Mossnote is open elsewhere', new Error('x')), {
      platform: 'p',
    });
    expect(await d.handle('app.status', {})).toEqual({
      ok: true,
      value: {
        state: 'error',
        code: 'unavailable',
        message: 'Mossnote is open elsewhere',
        platform: 'p',
      },
    });
    const through = ['app.status', 'app.quit', 'app.flushed'];
    for (const m of Object.keys(methods).filter((k) => !through.includes(k)))
      expect(await d.handle(m, {})).toEqual({
        ok: false,
        error: { code: 'unavailable', message: 'Mossnote is open elsewhere' },
      });
    expect(code(await d.handle('notes.get', { evil: 1 }))).toBe('unavailable');
    expect(d.close()).toEqual(ok(undefined));
  });

  it('a failed workspace still runs app.quit and app.flushed (the fatal-screen Quit must work)', async () => {
    let quit = 0;
    const flushed: string[] = [];
    const d = createDispatcher(err('corrupt', 'db damaged', new Error('x')), {
      onQuit: () => quit++,
      onFlushed: (t) => flushed.push(t),
    });
    expect((await d.handle('app.quit', {})).ok).toBe(true);
    expect((await d.handle('app.flushed', { token: 'tok' })).ok).toBe(true);
    expect(quit).toBe(1);
    expect(flushed).toEqual(['tok']);
    expect(code(await d.handle('notes.list', {}))).toBe('corrupt');
  });

  it('after close every call is unavailable', async () => {
    const { d, call } = setup();
    expect(d.close().ok).toBe(true);
    expect(code(await call('notes.list'))).toBe('unavailable');
    expect(code(await call('app.status'))).toBe('unavailable');
  });

  it('app.status is ready on a good workspace', async () => {
    const { val } = setup();
    expect(await val('app.status')).toEqual({ state: 'ready', platform: 'test' });
  });
});

describe('deriveTitle', () => {
  it.each([
    ['', ''],
    ['\n\n  \n', ''],
    ['Hello\nworld', 'Hello'],
    ['\n\n  Hello  \nx', 'Hello'],
    ['# Heading', 'Heading'],
    ['###   Spaced', 'Spaced'],
    ['﻿# Bom', 'Bom'],
    ['#\nNext', 'Next'],
    ['a\r\nb', 'a'],
    ['\r\rcr', 'cr'],
    ['# a # b', 'a # b'],
  ])('%j -> %j', (b, t) => expect(deriveTitle(b)).toBe(t));
  it('caps at 200 code points without splitting a pair', () => {
    const t = deriveTitle('😀'.repeat(300));
    expect([...t].length).toBe(200);
    expect(t.endsWith('😀')).toBe(true);
  });
});

describe('notes.save', () => {
  it('saves, derives the title, never echoes the body', async () => {
    const { val, ws } = setup();
    const n = await val('notes.create', { body: 'old' });
    const r = await val('notes.save', {
      id: n.id,
      body: '# New title\ntext',
      expectedContentHash: n.contentHash,
    });
    expect(Object.keys(r).sort()).toEqual(['contentHash', 'rev', 'title', 'updatedAt']);
    expect(r.title).toBe('New title');
    expect(r.contentHash).toBe(sha256('# New title\ntext'));
    expect(r.rev).toBe(n.rev + 1);
    const g = ws.notes.get(n.id);
    expect(g.ok && g.value.body).toBe('# New title\ntext');
  });

  it('conflict vs trashed vs not_found', async () => {
    const { val, call } = setup();
    const n = await val('notes.create', { body: 'a' });
    await val('notes.save', { id: n.id, body: 'b', expectedContentHash: n.contentHash });
    expect(
      code(await call('notes.save', { id: n.id, body: 'c', expectedContentHash: n.contentHash })),
    ).toBe('conflict');
    const cur = sha256('b');
    const { batchId } = await val('notes.trash', { id: n.id });
    expect(code(await call('notes.save', { id: n.id, body: 'c', expectedContentHash: cur }))).toBe(
      'trashed',
    );
    await val('trash.purge', { batchId, confirmed: true });
    expect(code(await call('notes.save', { id: n.id, body: 'c', expectedContentHash: cur }))).toBe(
      'not_found',
    );
  });

  it('a trashed folder makes its notes trashed too', async () => {
    const { val, call } = setup();
    const f = await val('folders.create', { name: 'F' });
    const n = await val('notes.create', { body: 'a', folderId: f.id });
    await val('folders.trash', { id: f.id });
    expect(
      code(await call('notes.save', { id: n.id, body: 'c', expectedContentHash: n.contentHash })),
    ).toBe('trashed');
  });

  it('size caps: 10 MB ok, one char over is validation', async () => {
    const { val, call } = setup();
    const n = await val('notes.create', {});
    const big = 'x'.repeat(10_000_000);
    expect(
      code(
        await call('notes.save', { id: n.id, body: big + 'x', expectedContentHash: n.contentHash }),
      ),
    ).toBe('validation');
    expect(
      code(await call('notes.save', { id: n.id, body: big, expectedContentHash: n.contentHash })),
    ).toBe('ok');
  });

  it('leaves no stale draft rows (journaled and pending) after a save', async () => {
    const { val, ws, d } = setup();
    const n = await val('notes.create', { body: 'a' });
    const base = { rev: n.rev, contentHash: n.contentHash };
    await val('drafts.write', { noteId: n.id, text: 'ab', base });
    // force the journal write via a second dispatcher-visible path: the recover after close below
    const count = () =>
      (ws.store.db.prepare('SELECT count(*) AS c FROM drafts').get() as { c: number }).c;
    await new Promise((r) => setTimeout(r, 900)); // core coalescing journals within 800 ms
    expect(count()).toBe(1);
    await val('drafts.write', { noteId: n.id, text: 'abc', base }); // pending, not journaled yet
    await val('notes.save', { id: n.id, body: 'abc', expectedContentHash: n.contentHash });
    expect(count()).toBe(0);
    await new Promise((r) => setTimeout(r, 900)); // the pending buffer must not resurrect a row
    expect(count()).toBe(0);
    expect(await val('drafts.recover')).toEqual([]);
    d.close();
  });

  it('does not delete a NEWER draft written after the save began', async () => {
    const { val, ws, d } = setup();
    const n = await val('notes.create', { body: 'a' });
    const base = { rev: n.rev, contentHash: n.contentHash };
    // Deferred: the save is started but not awaited; the newer draft is sent behind it (IPC order).
    const saving = d.handle('notes.save', {
      id: n.id,
      body: 'v1',
      expectedContentHash: n.contentHash,
    });
    const writing = d.handle('drafts.write', { noteId: n.id, text: 'v1 plus newer typing', base });
    const [s1, w1] = [await saving, await writing];
    expect([code(s1), code(w1)]).toEqual(['ok', 'ok']);
    await new Promise((r) => setTimeout(r, 900));
    const rows = ws.store.db.prepare('SELECT body FROM drafts WHERE note_id = ?').all(n.id);
    expect(rows).toEqual([{ body: 'v1 plus newer typing' }]);
    const rec = await val('drafts.recover');
    expect(rec).toHaveLength(1);
    expect(rec[0].baseChanged).toBe(true); // typed against the pre-save base: UI must ask
  });

  it('close flushes a pending draft into the journal', async () => {
    const { val, ws, d } = setup();
    const n = await val('notes.create', { body: 'a' });
    await val('drafts.write', {
      noteId: n.id,
      text: 'unsaved',
      base: { rev: n.rev, contentHash: n.contentHash },
    });
    const path = ws.store.path;
    expect(d.close().ok).toBe(true);
    const again = openWorkspace(path);
    if (!again.ok) throw new Error('reopen');
    const rec = again.value.drafts.recover();
    again.value.close();
    expect(rec.ok && rec.value.map((x) => x.body)).toEqual(['unsaved']);
  });

  it('forwards a drafts failure as a draftError event', async () => {
    const { val, ws, events } = setup();
    const n = await val('notes.create', { body: 'a' });
    await val('drafts.write', {
      noteId: n.id,
      text: 't',
      base: { rev: n.rev, contentHash: n.contentHash },
    });
    // Break the journal table so the timer flush fails; the event is asserted after.
    ws.store.db.exec('ALTER TABLE drafts RENAME TO drafts_gone');
    await new Promise((r) => setTimeout(r, 500));
    ws.store.db.exec('ALTER TABLE drafts_gone RENAME TO drafts');
    const ev = events.find((e) => e.type === 'draftError');
    expect(ev).toMatchObject({ type: 'draftError', noteId: n.id });
  });

  it('draftError carries the id of the note that failed, not one parsed from the message', async () => {
    const { val, ws, events } = setup();
    const a = await val('notes.create', { body: 'a' });
    const b = await val('notes.create', { body: 'b' });
    const base = (n: any) => ({ rev: n.rev, contentHash: n.contentHash });
    await val('drafts.write', { noteId: a.id, text: 'ta', base: base(a) });
    await val('drafts.write', { noteId: b.id, text: 'tb', base: base(b) });
    ws.store.db.exec('ALTER TABLE drafts RENAME TO drafts_gone');
    await new Promise((r) => setTimeout(r, 500));
    ws.store.db.exec('ALTER TABLE drafts_gone RENAME TO drafts');
    const ids = events.flatMap((e) => (e.type === 'draftError' ? [e.noteId] : []));
    expect(ids.sort()).toEqual([a.id, b.id].sort());
    for (const e of events) if (e.type === 'draftError') expect(e.message).not.toMatch(/^$/);
  });
});

describe('events', () => {
  it('emit changed after mutations and never carry note text', async () => {
    const { val, events } = setup();
    const n = await val('notes.create', { body: 'SECRET-TEXT' });
    await val('notes.save', {
      id: n.id,
      body: 'SECRET-TEXT 2',
      expectedContentHash: n.contentHash,
    });
    const f = await val('folders.create', { name: 'Folder' });
    await val('notes.move', { id: n.id, folderId: f.id });
    await val('notes.setFavorite', { id: n.id, favorite: true });
    const t = await val('tags.create', { name: 'tag' });
    await val('tags.tagNote', { noteId: n.id, tagId: t.id });
    const { batchId } = await val('notes.trash', { id: n.id });
    await val('trash.restore', { batchId });
    await val('notes.list');
    const kinds = new Set(events.map((e) => (e.type === 'changed' ? e.entity : e.type)));
    expect(kinds).toEqual(new Set(['note', 'folder', 'tag', 'trash']));
    expect(events.some((e) => e.type === 'changed' && e.content)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('SECRET');
    structuredClone(events);
  });

  it('failed mutations and reads emit nothing; unsubscribe works', async () => {
    const { d, call, events } = setup();
    await call('notes.trash', { id: 'missing' });
    await call('notes.list');
    expect(events).toEqual([]);
    const got: RpcEvent[] = [];
    const off = d.onEvent((e) => got.push(e));
    off();
    await call('folders.create', { name: 'x' });
    expect(got).toEqual([]);
    expect(events).toHaveLength(1);
  });
});

describe('notes.list filters', () => {
  it('favorite and tagId', async () => {
    const { val } = setup();
    const a = await val('notes.create', { body: 'a' });
    const b = await val('notes.create', { body: 'b' });
    await val('notes.setFavorite', { id: a.id, favorite: true });
    const t = await val('tags.create', { name: 'x' });
    await val('tags.tagNote', { noteId: b.id, tagId: t.id });
    expect((await val('notes.list', { favorite: true })).map((x: any) => x.id)).toEqual([a.id]);
    expect((await val('notes.list', { tagId: t.id })).map((x: any) => x.id)).toEqual([b.id]);
    expect(await val('notes.list', { tagId: 'none' })).toEqual([]);
    expect((await val('notes.list', { favorite: false })).map((x: any) => x.id)).toEqual([b.id]);
    expect(await val('notes.list')).toHaveLength(2);
    expect((await val('notes.list'))[0]).not.toHaveProperty('body');
  });
});

describe('prefs', () => {
  it('defaults, partial set, persistence', async () => {
    const { val } = setup();
    expect(await val('prefs.get')).toEqual({
      theme: 'system',
      navWidth: 240,
      listWidth: 320,
      navCollapsed: false,
      attachmentMaxBytes: 200 * 1024 * 1024,
    });
    expect(await val('prefs.set', { navWidth: 300, theme: 'dark' })).toMatchObject({
      navWidth: 300,
      theme: 'dark',
      listWidth: 320,
    });
    expect(await val('prefs.get')).toMatchObject({ navWidth: 300, theme: 'dark' });
  });

  it('bounds and strictness', async () => {
    const { call } = setup();
    for (const bad of [
      { navWidth: 119 },
      { navWidth: 801 },
      { listWidth: 1.5 },
      { theme: 'blue' },
      { navCollapsed: 1 },
      { attachmentMaxBytes: 1024 * 1024 - 1 },
      { attachmentMaxBytes: 1024 * 1024 * 1024 + 1 },
      { extra: 1 },
    ])
      expect(code(await call('prefs.set', bad))).toBe('validation');
    for (const good of [
      { navWidth: 120 },
      { listWidth: 800 },
      { attachmentMaxBytes: 1024 * 1024 },
      { attachmentMaxBytes: 1024 * 1024 * 1024 },
      {},
    ])
      expect(code(await call('prefs.set', good))).toBe('ok');
    expect(
      prefsSchema.safeParse({
        theme: 'light',
        navWidth: 120,
        listWidth: 800,
        navCollapsed: true,
        attachmentMaxBytes: 5_000_000,
      }).success,
    ).toBe(true);
  });

  it('corrupt or out-of-range stored JSON falls back to defaults', async () => {
    const { val, ws } = setup();
    const put = (v: string) =>
      ws.store.db
        .prepare(
          "INSERT INTO meta(key,value) VALUES('ui_prefs',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(v);
    put('{not json');
    expect(await val('prefs.get')).toMatchObject({ theme: 'system', navWidth: 240 });
    put('[1,2]');
    expect(await val('prefs.get')).toMatchObject({ navWidth: 240 });
    put(JSON.stringify({ navWidth: 99999, listWidth: 400, theme: 'dark', junk: 1 }));
    expect(await val('prefs.get')).toEqual({
      theme: 'dark',
      navWidth: 240,
      listWidth: 400,
      navCollapsed: false,
      attachmentMaxBytes: 200 * 1024 * 1024,
    });
  });
});

describe('capture.save', () => {
  it('creates one Inbox, reuses it, returns {noteId}', async () => {
    const { val, call } = setup();
    const a = await val('capture.save', { text: 'first thought\nmore' });
    const b = await val('capture.save', { text: 'second' });
    expect(Object.keys(a)).toEqual(['noteId']);
    const folders = (await val('folders.list')).filter((f: any) => f.name === 'Inbox');
    expect(folders).toHaveLength(1);
    const notes = await val('notes.list', { folderId: folders[0].id });
    expect(notes.map((n: any) => n.id).sort()).toEqual([a.noteId, b.noteId].sort());
    expect(notes.find((n: any) => n.id === a.noteId).title).toBe('first thought');
    expect(code(await call('capture.save', { text: '' }))).toBe('validation');
    expect(code(await call('capture.save', { text: 'x'.repeat(1_000_001) }))).toBe('validation');
    expect(code(await call('capture.save', { text: 'x'.repeat(1_000_000) }))).toBe('ok');
  });

  it('recreates the Inbox when trashed or purged', async () => {
    const { val } = setup();
    await val('capture.save', { text: 'a' });
    const inbox1 = (await val('folders.list')).find((f: any) => f.name === 'Inbox');
    const { batchId } = await val('folders.trash', { id: inbox1.id });
    await val('capture.save', { text: 'b' });
    const inbox2 = (await val('folders.list')).find((f: any) => f.name === 'Inbox');
    expect(inbox2.id).not.toBe(inbox1.id);
    await val('trash.purge', { batchId, confirmed: true });
    await val('capture.save', { text: 'c' });
    expect((await val('folders.list')).filter((f: any) => f.name === 'Inbox')).toHaveLength(1);
    // deleted outright (purge of the live one)
    const { batchId: b2 } = await val('folders.trash', { id: inbox2.id });
    await val('trash.purge', { batchId: b2, confirmed: true });
    const c = await val('capture.save', { text: 'd' });
    expect((await val('notes.get', { id: c.noteId })).trashed).toBe(false);
  });
});

describe('capture inbox crash safety', () => {
  it('adopts an Inbox folder whose meta write was lost', async () => {
    const { val, ws } = setup();
    const orphan = ws.folders.create({}, { name: 'Inbox' }); // crash before setMeta
    if (!orphan.ok) throw new Error('setup');
    const a = await val('capture.save', { text: 'a' });
    await val('capture.save', { text: 'b' });
    const inboxes = (await val('folders.list')).filter((f: any) => f.name === 'Inbox');
    expect(inboxes.map((f: any) => f.id)).toEqual([orphan.value.id]);
    expect((await val('notes.get', { id: a.noteId })).folderId).toBe(orphan.value.id);
  });
});

describe('app.quit, app.openCapture, drafts.flush, emit', () => {
  it('call the hooks and flush the journal', async () => {
    const dir = tmp();
    const r = openWorkspace(join(dir, 'w.db'));
    if (!r.ok) throw new Error('open');
    let quit = 0;
    let cap = 0;
    const d = createDispatcher(r, { onQuit: () => quit++, onOpenCapture: () => cap++ });
    open.push(d);
    const events: RpcEvent[] = [];
    d.onEvent((e) => events.push(e));
    expect((await d.handle('app.quit', {})).ok).toBe(true);
    expect((await d.handle('app.openCapture', {})).ok).toBe(true);
    expect([quit, cap]).toEqual([1, 1]);
    const n = r.value.notes.create({}, { title: 't', body: 'x', folderId: null });
    if (!n.ok) throw new Error('note');
    const w = await d.handle('drafts.write', {
      noteId: n.value.id,
      text: 'typed',
      base: { rev: n.value.rev, contentHash: n.value.contentHash },
    });
    expect(w.ok).toBe(true);
    const f = await d.handle('drafts.flush', { noteId: n.value.id });
    structuredClone(f);
    expect(f.ok && typeof f.value === 'object' && Object.keys(f.value as object)).toEqual([
      n.value.id,
    ]);
    const rec = await d.handle('drafts.recover', {});
    expect(rec.ok && (rec.value as unknown[]).length).toBe(1);
    expect((await d.handle('drafts.flush', { noteId: '' })).ok).toBe(false);
    d.emit({ type: 'status', message: 'm', level: 'warn' });
    expect(events).toEqual([{ type: 'status', message: 'm', level: 'warn' }]);
  });
});

describe('structured clone and the rest of the surface', () => {
  it('every read and write reply clones', async () => {
    const { val, call } = setup();
    const n = await val('notes.create', { body: 'x' });
    const f = await val('folders.create', { name: 'F' });
    const t = await val('tags.create', { name: 'T' });
    const calls: [string, unknown][] = [
      ['app.status', {}],
      ['notes.list', {}],
      ['notes.get', { id: n.id }],
      ['notes.save', { id: n.id, body: 'y', expectedContentHash: n.contentHash }],
      ['notes.move', { id: n.id, folderId: f.id }],
      ['notes.setFavorite', { id: n.id, favorite: true }],
      ['folders.list', {}],
      ['folders.rename', { id: f.id, name: 'G' }],
      ['folders.move', { id: f.id, parentId: null }],
      ['tags.list', {}],
      ['tags.rename', { id: t.id, name: 'U' }],
      ['tags.forNote', { noteId: n.id }],
      ['tags.tagNote', { noteId: n.id, tagId: t.id }],
      ['tags.untagNote', { noteId: n.id, tagId: t.id }],
      ['drafts.recover', {}],
      ['drafts.discard', { noteId: n.id, upToSeq: 5 }],
      ['prefs.get', {}],
      ['prefs.set', { navCollapsed: true }],
      ['trash.list', {}],
      ['app.flushed', { token: 't' }],
      ['notes.trash', { id: n.id }],
      ['no.such', {}],
    ];
    for (const [m, a] of calls) {
      const r = await call(m, a); // call() runs structuredClone
      if (m !== 'no.such') expect(r.ok, `${m}`).toBe(true);
    }
  });

  it('app.flushed reaches the hook', async () => {
    const r = openWorkspace(join(tmp(), 'w.db'));
    if (!r.ok) throw new Error('open');
    const tokens: string[] = [];
    const d = createDispatcher(r, { onFlushed: (t) => tokens.push(t) });
    open.push(d);
    await d.handle('app.flushed', { token: 'abc' });
    expect(tokens).toEqual(['abc']);
  });
});
