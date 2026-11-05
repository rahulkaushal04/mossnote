/* eslint-disable @typescript-eslint/no-explicit-any -- test replies are untyped JSON */
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attachmentUrl } from '../../src/attachments/links.ts';
import { blobPathIn } from '../../src/attachments/scan.ts';
import { methods, CAPTURE_METHODS, createDispatcher, type Dispatcher, type RpcEvent, type RpcResult } from '../../src/rpc/index.ts';
import { openWorkspace } from '../../src/workspace.ts';
import { tmp } from '../store/helpers.ts';
import { makePdf, PNG, sha, textPdf } from '../attachments/util.ts';
import type { PdfTextExtractor } from '../../src/attachments/pdfText.ts';

const open: Dispatcher[] = [];
afterEach(() => {
  for (const d of open.splice(0)) d.close();
});
const code = (r: RpcResult<unknown>) => (r.ok ? 'ok' : r.error.code);

function setup(o: { resolver?: boolean; pdf?: PdfTextExtractor | null } = {}) {
  const dir = tmp();
  const dbPath = join(dir, 'w.db');
  const r = openWorkspace(dbPath, { attachments: { pdf: o.pdf === undefined ? null : o.pdf } });
  if (!r.ok) throw new Error(r.error.message);
  const tokens = new Map<string, string>();
  const scheduled: (() => void)[] = [];
  const d = createDispatcher(r, {
    platform: 'test',
    resolveUploadPath: o.resolver === false ? undefined : (t) => tokens.get(t),
    scheduleExtract: (run) => void scheduled.push(run),
  });
  open.push(d);
  const events: RpcEvent[] = [];
  d.onEvent((e) => events.push(e));
  const call = async (m: unknown, a: unknown = {}) => {
    const reply = await d.handle(m, a);
    structuredClone(reply); // every reply must survive IPC
    return reply;
  };
  const val = async <T = any>(m: string, a: unknown = {}): Promise<T> => {
    const x = await call(m, a);
    if (!x.ok) throw new Error(`${m}: ${x.error.code} ${x.error.message}`);
    return x.value as T;
  };
  /** A file "picked" by the user in the main process: written to disk, a token issued. */
  const pick = (name: string, content: Uint8Array | string): string => {
    const p = join(dir, name);
    writeFileSync(p, content);
    const token = `tok-${tokens.size}`;
    tokens.set(token, p);
    return token;
  };
  return { dir, ws: r.value, d, events, call, val, pick, scheduled, root: join(dir, 'attachments') };
}
const ATT = Object.keys(methods).filter((m) => m.startsWith('attachments.'));

describe('attachments RPC surface', () => {
  it('is exactly the agreed list, with nothing that opens, runs or accepts raw bytes or paths', () => {
    expect([...ATT].sort()).toEqual(
      [
        'attachments.addPath',
        'attachments.list',
        'attachments.remove',
        'attachments.info',
        'attachments.cleanupPreview',
        'attachments.cleanupRun',
        'attachments.verifyAll',
      ].sort(),
    );
    for (const bad of ['attachments.open', 'attachments.addBytes', 'attachments.paste', 'attachments.exec'])
      expect(Object.keys(methods)).not.toContain(bad);
  });

  it('none of them is available to the capture window', () => {
    for (const m of CAPTURE_METHODS) expect(m.startsWith('attachments.')).toBe(false);
  });

  it('every method is strict: unknown keys, non-objects and bad ids are validation errors', async () => {
    const { call } = setup();
    const h = sha('x');
    const good: Record<string, unknown> = {
      'attachments.addPath': { noteId: 'n', token: 't' },
      'attachments.list': { noteId: 'n' },
      'attachments.remove': { refId: 'r' },
      'attachments.info': { sha256: h },
      'attachments.cleanupPreview': {},
      'attachments.cleanupRun': { sha256s: [h], confirmed: true },
      'attachments.verifyAll': {},
    };
    for (const m of ATT) {
      expect(code(await call(m, { ...(good[m] as object), __extra: 1 })), m).toBe('validation');
      expect(code(await call(m, 'x')), m).toBe('validation');
      expect(code(await call(m, null)), m).toBe('validation');
    }
    const bad: [string, unknown][] = [
      ['attachments.addPath', { noteId: '', token: 't' }],
      ['attachments.addPath', { noteId: 'n', token: '' }],
      ['attachments.addPath', { noteId: 'n', token: 't'.repeat(129) }],
      ['attachments.addPath', { noteId: 'n' }],
      ['attachments.addPath', { noteId: 'n', token: 't', path: '/etc/passwd' }], // a renderer cannot supply a path
      ['attachments.addPath', { noteId: 'n', path: '/etc/passwd' }],
      ['attachments.addPath', { noteId: 'n', token: 't', bytes: [1, 2, 3] }],
      ['attachments.list', { noteId: 'x'.repeat(65) }],
      ['attachments.remove', {}],
      ['attachments.info', { sha256: h.toUpperCase() }],
      ['attachments.info', { sha256: h.slice(1) }],
      ['attachments.info', { sha256: h, verify: 'yes' }],
      ['attachments.cleanupRun', { sha256s: [h] }],
      ['attachments.cleanupRun', { sha256s: [h], confirmed: false }],
      ['attachments.cleanupRun', { sha256s: [h], confirmed: 'true' }],
      ['attachments.cleanupRun', { sha256s: ['../../x'], confirmed: true }],
    ];
    for (const [m, a] of bad) expect(code(await call(m, a)), `${m} ${JSON.stringify(a).slice(0, 60)}`).toBe('validation');
    // the boundary itself: exactly 10 000 hashes parse, 10 001 do not
    const many = (n: number) => ({ sha256s: Array.from({ length: n }, (_, i) => sha(String(i))), confirmed: true });
    expect(methods['attachments.cleanupRun'].args.safeParse(many(10_000)).success).toBe(true);
    expect(methods['attachments.cleanupRun'].args.safeParse(many(10_001)).success).toBe(false);
  });
});

describe('attachments.addPath with a main-process token', () => {
  it('without a resolver it is unavailable; an unknown or expired token is a validation error', async () => {
    const a = setup({ resolver: false });
    const n = await a.val('notes.create', { body: 'x' });
    expect(code(await a.call('attachments.addPath', { noteId: n.id, token: 'whatever' }))).toBe('unavailable');
    const b = setup();
    const m = await b.val('notes.create', { body: 'x' });
    const r = await b.call('attachments.addPath', { noteId: m.id, token: 'nope' });
    expect(code(r)).toBe('validation');
    expect(JSON.stringify(r)).not.toContain(b.dir);
  });

  it('adds the picked file, replies with the ref, announces the change and lists it', async () => {
    const t = setup();
    const n = await t.val('notes.create', { body: 'x' });
    const token = t.pick('Photo 1.png', PNG);
    const ref = await t.val('attachments.addPath', { noteId: n.id, token });
    expect(ref).toMatchObject({ noteId: n.id, sha256: sha(PNG), name: 'Photo 1.png', kind: 'image', mime: 'image/png', size: PNG.length, verifyState: 'ok' });
    expect(ref.url).toBe(attachmentUrl(sha(PNG)));
    expect(ref.markdown).toBe(`![Photo 1.png](${attachmentUrl(sha(PNG))})`);
    expect(JSON.stringify(ref)).not.toContain(t.dir); // no filesystem path ever reaches the renderer
    expect(t.events).toContainEqual({ type: 'changed', entity: 'attachment', ids: [n.id] });
    expect(await t.val('attachments.list', { noteId: n.id })).toEqual([ref]);
    // the same file via another token: same blob and same ref
    const again = await t.val('attachments.addPath', { noteId: n.id, token: t.pick('copy.png', PNG) });
    expect(again.refId).toBe(ref.refId);
  });

  it('errors carry code and message only, never the path or a cause', async () => {
    const t = setup();
    const n = await t.val('notes.create', { body: 'x' });
    const token = t.pick('gone.png', PNG);
    rmSync(join(t.dir, 'gone.png'));
    const r = await t.call('attachments.addPath', { noteId: n.id, token });
    expect(r).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(Object.keys((r as any).error).sort()).toEqual(['code', 'message']);
    expect(JSON.stringify(r)).not.toContain(t.dir);
    expect(code(await t.call('attachments.addPath', { noteId: 'missing-note', token: t.pick('b.png', PNG) }))).toBe('not_found');
    await t.val('notes.trash', { id: n.id });
    expect(code(await t.call('attachments.addPath', { noteId: n.id, token: t.pick('c.png', PNG) }))).toBe('trashed');
  });

  it('PDF text is extracted after the reply and announced, and search then finds it', async () => {
    const t = setup({ pdf: textPdf('persimmon jam') });
    const n = await t.val('notes.create', { body: 'plain' });
    const ref = await t.val('attachments.addPath', { noteId: n.id, token: t.pick('r.pdf', makePdf('x')) });
    expect(ref.textState).toBe('pending');
    t.events.length = 0;
    for (const run of t.scheduled.splice(0)) run();
    await t.ws.attachments.extractPending(); // the same in-flight pass the scheduled run started
    await new Promise((r) => setTimeout(r, 20));
    expect(t.events).toContainEqual({ type: 'changed', entity: 'attachment', ids: [n.id] });
    expect((await t.val('attachments.list', { noteId: n.id }))[0].textState).toBe('done');
    const found = await t.val('search.run', { query: 'persimmon' });
    expect(found.hits.map((h: any) => h.noteId)).toEqual([n.id]);
  });
});

describe('info, remove, verify and cleanup over RPC', () => {
  it('info reports the blob, verifies on request, and names the note when the file is damaged', async () => {
    const t = setup();
    const n = await t.val('notes.create', { body: 'Quarterly' });
    const ref = await t.val('attachments.addPath', { noteId: n.id, token: t.pick('q3.txt', 'quarterly numbers') });
    const info = await t.val('attachments.info', { sha256: ref.sha256 });
    expect(info).toMatchObject({ sha256: ref.sha256, kind: 'text', verifyState: 'ok', refs: [{ refId: ref.refId, noteId: n.id, name: 'q3.txt' }] });
    expect(info.state).toBeUndefined();
    expect((await t.val('attachments.info', { sha256: ref.sha256, verify: true })).state).toBe('ok');
    const p = blobPathIn(t.root, ref.sha256);
    chmodSync(p, 0o600);
    const bytes = readFileSync(p);
    bytes[0] = bytes[0]! ^ 0xff;
    writeFileSync(p, bytes);
    const bad = await t.val('attachments.info', { sha256: ref.sha256, noteId: n.id, verify: true });
    expect(bad.state).toBe('corrupt');
    expect(bad.message).toContain('q3.txt');
    expect(bad.message).toMatch(/backup/i);
    expect(code(await t.call('attachments.info', { sha256: sha('unknown') }))).toBe('not_found');
  });

  it('remove returns nothing, announces the change, and leaves the file for Cleanup', async () => {
    const t = setup();
    const n = await t.val('notes.create', { body: 'x' });
    const ref = await t.val('attachments.addPath', { noteId: n.id, token: t.pick('a.txt', 'abc') });
    t.events.length = 0;
    expect(await t.val('attachments.remove', { refId: ref.refId })).toBeUndefined();
    expect(t.events).toContainEqual({ type: 'changed', entity: 'attachment' });
    expect(await t.val('attachments.list', { noteId: n.id })).toEqual([]);
    expect(code(await t.call('attachments.remove', { refId: ref.refId }))).toBe('not_found');
    const pv = await t.val('attachments.cleanupPreview');
    expect(pv.items).toEqual([expect.objectContaining({ sha256: ref.sha256, size: 3, untracked: false })]);
    expect(pv.totalBytes).toBe(3);
  });

  it('cleanupRun deletes only after confirmation and never a referenced file', async () => {
    const t = setup();
    const n = await t.val('notes.create', { body: 'x' });
    const keep = await t.val('attachments.addPath', { noteId: n.id, token: t.pick('keep.txt', 'keep me') });
    const drop = await t.val('attachments.addPath', { noteId: n.id, token: t.pick('drop.txt', 'drop me') });
    await t.val('attachments.remove', { refId: drop.refId });
    expect(code(await t.call('attachments.cleanupRun', { sha256s: [drop.sha256], confirmed: false }))).toBe('validation');
    const res = await t.val('attachments.cleanupRun', { sha256s: [keep.sha256, drop.sha256], confirmed: true });
    expect(res).toEqual({ deleted: 1, bytes: 'drop me'.length, skipped: [keep.sha256] });
    expect((await t.val('attachments.info', { sha256: keep.sha256, verify: true })).state).toBe('ok');
    expect(code(await t.call('attachments.info', { sha256: drop.sha256 }))).toBe('not_found');
  });

  it('verifyAll replies with the report', async () => {
    const t = setup();
    const n = await t.val('notes.create', { body: 'x' });
    await t.val('attachments.addPath', { noteId: n.id, token: t.pick('a.txt', 'abc') });
    expect(await t.val('attachments.verifyAll')).toEqual({ checked: 1, ok: 1, missing: [], corrupt: [], untracked: [] });
  });

  it('after close every attachments call is unavailable', async () => {
    const t = setup();
    t.d.close();
    expect(code(await t.call('attachments.list', { noteId: 'n' }))).toBe('unavailable');
  });
});
