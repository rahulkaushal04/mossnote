/* eslint-disable @typescript-eslint/no-explicit-any -- test replies are untyped JSON */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { setMeta } from '../../src/db/meta.ts';
import {
  CAPTURE_METHODS,
  createDispatcher,
  type Dispatcher,
  type RpcEvent,
} from '../../src/rpc/index.ts';
import { ok } from '../../src/result.ts';
import { createSearchApi } from '../../src/search/index.ts';
import { openWorkspace, type Workspace } from '../../src/workspace.ts';

const dirs: string[] = [];
const open: Dispatcher[] = [];
afterEach(() => {
  for (const d of open.splice(0)) d.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A scheduler the test drives by hand. */
function manual() {
  const q: Array<() => void> = [];
  return {
    schedule: (f: () => void) => void q.push(f),
    pending: () => q.length,
    tick: () => {
      const f = q.shift();
      f?.();
      return f !== undefined;
    },
    drain: () => {
      let n = 0;
      while (q.length && n++ < 1000) q.shift()!();
    },
  };
}

function openAt(dir: string, slice = 3): Workspace {
  const r = openWorkspace(join(dir, 'w.db'));
  if (!r.ok) throw new Error(r.error.message);
  return { ...r.value, search: createSearchApi(r.value.store, { sliceSize: slice }) };
}
function mk(dir: string, sched = manual(), ws = openAt(dir)) {
  const d = createDispatcher(ok(ws), { platform: 'test', schedule: sched.schedule });
  open.push(d);
  const events: RpcEvent[] = [];
  d.onEvent((e) => events.push(e));
  const call = async (m: unknown, a: unknown = {}) => {
    const reply = await d.handle(m, a);
    structuredClone(reply);
    return reply;
  };
  const val = async <T = any>(m: string, a: unknown = {}): Promise<T> => {
    const r = await call(m, a);
    if (!r.ok) throw new Error(`${m}: ${r.error.code} ${r.error.message}`);
    return r.value as T;
  };
  return { d, ws, events, call, val, sched };
}
function setup(notes = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'mossnote-rpcs-'));
  dirs.push(dir);
  const ws = openAt(dir);
  for (let i = 0; i < notes; i++)
    ws.notes.create({}, { title: `note ${i}`, body: `alpha beta note ${i}`, folderId: null });
  return { dir, ws };
}
/** Fills the root page of the FTS data table with 0xff: page-level damage inside a shadow table. */
function damageShadowPage(path: string): void {
  const db = new Database(path);
  const root = (
    db.prepare("SELECT rootpage AS r FROM sqlite_schema WHERE name = 'note_fts_data'").get() as {
      r: number;
    }
  ).r;
  db.close();
  const buf = readFileSync(path);
  const ps = buf.readUInt16BE(16) || 65536;
  buf.fill(0xff, (root - 1) * ps + 20, root * ps);
  writeFileSync(path, buf);
}
function must<T>(r: { ok: boolean; value?: T; error?: { message: string } }): T {
  if (!r.ok) throw new Error(r.error?.message);
  return r.value as T;
}
function unwrapVoid(r: { ok: boolean; error?: { message: string } }): void {
  if (!r.ok) throw new Error(r.error?.message);
}
const states = (ev: RpcEvent[]) => ev.flatMap((e) => (e.type === 'searchState' ? [e] : []));

/** A well-formed query from a grammar: words, prefixes, phrases, exclusions, tag:/folder: filters. */
function grammarQuery(rnd: () => number, max: number): string {
  const words = ['alpha', 'beta', 'note', 'café', 'Zürich', 'naïve', 'x1', 'ß', '日本語', '😀'];
  const w = () => words[Math.floor(rnd() * words.length)]!;
  const atom = (): string => {
    const k = Math.floor(rnd() * 9);
    if (k === 0) return `${w().slice(0, 2)}*`;
    if (k === 1) return `"${w()} ${w()}"`;
    if (k === 2) return `-${w()}`;
    if (k === 3) return `-"${w()} ${w()}"`;
    if (k === 4) return `tag:${w()}`;
    if (k === 5) return `folder:"${w()} ${w()}"`;
    return w();
  };
  let s = '';
  for (let n = Math.floor(rnd() * 30); n >= 0; n--) {
    const a = atom();
    if (s.length + a.length + 1 > max) break;
    s += `${a} `;
  }
  return s.trim();
}

const intIn = (v: unknown, lo: number, hi: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const idOk = (v: unknown): boolean => typeof v === 'string' && v.length >= 1 && v.length <= 64;
/** Independent statement of the params contract (not the zod schema): which params must be refused. */
function malformed(p: any): boolean {
  const f = p.filters;
  const sc = p.scope;
  return (
    (p.limit !== undefined && !intIn(p.limit, 1, 100)) ||
    (p.sort !== undefined && !['relevance', 'updated', 'created', 'title'].includes(p.sort)) ||
    (p.dir !== undefined && !['asc', 'desc'].includes(p.dir)) ||
    (sc !== undefined &&
      (!['all', 'trash', 'favorites', 'tag', 'folder'].includes(sc.kind) ||
        (sc.id !== undefined && !idOk(sc.id)) ||
        ((sc.kind === 'tag' || sc.kind === 'folder') && sc.id === undefined))) ||
    (f !== undefined &&
      (['tagIds', 'folderIds'].some(
        (k) => f[k] !== undefined && (f[k].length > 20 || !f[k].every(idOk)),
      ) ||
        ['createdFrom', 'createdTo', 'updatedFrom', 'updatedTo'].some(
          (k) => f[k] !== undefined && !intIn(f[k], 0, 8_640_000_000_000_000),
        )))
  );
}

describe('search contract', () => {
  it('search methods are not capture methods', () => {
    for (const m of CAPTURE_METHODS) expect(m.startsWith('search.')).toBe(false);
  });

  it('runs a search and returns a structured-clone-safe page', async () => {
    const { dir, ws } = setup(3);
    ws.search.rebuild();
    const t = mk(dir, undefined, ws);
    const page = await t.val('search.run', { query: 'alpha' });
    expect(page.state).toBe('ready');
    expect(page.hits).toHaveLength(3);
    expect(await t.val('search.status')).toEqual({ state: 'ready' });
    expect(await t.val('search.verify')).toEqual({ ok: true });
  });

  it('rejects bad args with validation', async () => {
    const { dir, ws } = setup(1);
    ws.search.rebuild();
    const t = mk(dir, undefined, ws);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    const bad: unknown[] = [
      { query: 'a', limit: 0 },
      { query: 'a', limit: 101 },
      { query: 'a', limit: 1.5 },
      { query: 'x'.repeat(11_000_000) },
      { query: 'x'.repeat(1001) },
      { query: 'a', extra: 1 },
      JSON.parse('{"query":"a","__proto__":{"x":1}}'),
      JSON.parse('{"query":"a","filters":{"__proto__":1}}'),
      { query: 'a', filters: { tagIds: ids(21) } },
      { query: 'a', filters: { folderIds: ['x'.repeat(65)] } },
      { query: 'a', filters: { tagIds: [''] } },
      { query: 'a', filters: { createdFrom: -1 } },
      { query: 'a', filters: { createdFrom: 1e300 } },
      { query: 'a', filters: { updatedTo: 1.5 } },
      { query: 'a', scope: { kind: 'tag' } },
      { query: 'a', scope: { kind: 'nope' } },
      { query: 'a', sort: 'random' },
      { query: 'a', cursor: 'c'.repeat(2001) },
      { query: 5 },
      {},
      null,
    ];
    for (const a of bad) {
      const r = await t.call('search.run', a);
      expect(r.ok, JSON.stringify(a)?.slice(0, 80)).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('validation');
    }
  });

  it('a tampered cursor is a validation error', async () => {
    const { dir, ws } = setup(4);
    ws.search.rebuild();
    const t = mk(dir, undefined, ws);
    const p = await t.val('search.run', { query: 'alpha', limit: 1 });
    expect(p.nextCursor).toBeTruthy();
    const other = await t.call('search.run', {
      query: 'alpha',
      limit: 1,
      sort: 'title',
      cursor: p.nextCursor,
    });
    const junk = await t.call('search.run', { query: 'alpha', cursor: 'not-a-cursor' });
    const forged = Buffer.from(JSON.stringify({ s: 'updated', d: 'asc', k: 'x', id: 1 })).toString(
      'base64url',
    );
    const f = await t.call('search.run', { query: 'alpha', cursor: forged });
    for (const r of [junk, f]) expect(!r.ok && r.error.code).toBe('validation');
    expect(!other.ok && other.error.code).toBe('validation'); // a relevance cursor never pages a title sort
    // a genuine cursor still pages
    const p2 = await t.val('search.run', { query: 'alpha', limit: 1, cursor: p.nextCursor });
    expect(p2.hits[0].noteId).not.toBe(p.hits[0].noteId);
  });

  it('well-formed queries up to 1000 characters always return ok pages; 1001 is refused', async () => {
    const { dir, ws } = setup(6);
    ws.search.rebuild();
    const t = mk(dir, undefined, ws);
    let seed = 7;
    const rnd = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return (seed % 10_000) / 10_000;
    };
    const queries = [
      'a'.repeat(1000),
      'alpha '.repeat(166),
      '"alpha beta" '.repeat(76),
      ...Array.from({ length: 300 }, () => grammarQuery(rnd, 1000)),
    ];
    for (const query of queries) {
      expect(query.length).toBeLessThanOrEqual(1000);
      const r = await t.call('search.run', { query });
      expect(r.ok, query.slice(0, 60)).toBe(true);
    }
    const over = await t.call('search.run', { query: 'a'.repeat(1001) });
    expect(!over.ok && over.error.code).toBe('validation');
  });

  it('fuzz: 10,000 random queries and params: well-formed => ok page, malformed => validation, never internal', async () => {
    const { dir, ws } = setup(6);
    ws.search.rebuild();
    const t = mk(dir, undefined, ws);
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x1234567) | 0;
      seed ^= seed >>> 12;
      return ((seed >>> 0) % 1_000_000) / 1_000_000;
    };
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
    const atoms = [
      'alpha',
      'beta',
      'note',
      '"',
      '""',
      '"alpha beta"',
      '-',
      '--',
      'OR',
      'AND',
      'NOT',
      '(',
      ')',
      '*',
      'al*',
      'tag:',
      'tag:x',
      'folder:',
      'in:trash',
      'is:fav',
      'title:',
      'body:',
      ':',
      '^',
      '~',
      "'",
      '\\',
      'NEAR(',
      'NEAR/3',
      'é',
      'ß',
      '日本語',
      '😀',
      '\ud800',
      '\u0000',
      '\u0007',
      '\n',
      '\t',
      ' ',
      '   ',
      '{',
      '}',
      '[',
      ']',
      '%',
      '_',
      ';',
      "'; DROP TABLE notes; --",
      'x'.repeat(900),
    ];
    // Any string up to the 1000-character limit is a well-formed query: it must come back as an ok page.
    const genQuery = () => {
      if (rnd() < 0.02) return 'z'.repeat(1 + Math.floor(rnd() * 1000));
      if (rnd() < 0.4) return grammarQuery(rnd, 1000);
      let s = '';
      for (let n = Math.floor(rnd() * 8); n >= 0; n--) s += pick(atoms) + (rnd() < 0.6 ? ' ' : '');
      return s.slice(0, 1000);
    };
    const ids = () =>
      Array.from({ length: Math.floor(rnd() * 23) }, () =>
        pick(['a', 'b', 'x'.repeat(65), '', 'tag1']),
      );
    const real = (await t.val('search.run', { query: 'alpha', limit: 1 })).nextCursor as string;
    const bad: unknown[] = [];
    for (let i = 0; i < 10_000; i++) {
      const p: any = { query: genQuery() };
      if (rnd() < 0.3) p.limit = pick([0, 1, 5, 50, 100, 101, -1, 2.5]);
      if (rnd() < 0.3) p.sort = pick(['relevance', 'updated', 'created', 'title', 'bogus']);
      if (rnd() < 0.2) p.dir = pick(['asc', 'desc', 'up']);
      if (rnd() < 0.3)
        p.scope = {
          kind: pick(['all', 'trash', 'favorites', 'tag', 'folder', 'x']),
          ...(rnd() < 0.6 ? { id: pick(['', 'zz', 'a'.repeat(70)]) } : {}),
        };
      if (rnd() < 0.3)
        p.filters = {
          ...(rnd() < 0.5 ? { tagIds: ids() } : {}),
          ...(rnd() < 0.3 ? { folderIds: ids() } : {}),
          ...(rnd() < 0.3 ? { createdFrom: pick([0, 5, -3, 1e18, 1.5]) } : {}),
          ...(rnd() < 0.3 ? { updatedTo: pick([0, Date.now(), 8.64e15, 9e15]) } : {}),
          ...(rnd() < 0.3 ? { favorite: pick([true, false]) } : {}),
        };
      if (rnd() < 0.2)
        p.cursor = pick([
          real,
          'junk',
          '',
          real.slice(0, -3),
          real + 'A',
          Buffer.from(
            `{"s":"${pick(['title', 'updated', 'q'])}","d":"asc","k":${pick(['1', '"k"', 'null'])},"id":"${pick(['i', ''])}"}`,
          ).toString('base64url'),
        ]);
      const r = await t.call('search.run', p);
      const code = r.ok ? 'ok' : r.error.code;
      if (code === 'internal') bad.push(['internal', p]);
      // A cursor may legitimately be refused; without one the outcome is fixed by the params alone.
      else if (p.cursor === undefined && code !== (malformed(p) ? 'validation' : 'ok'))
        bad.push([code, !r.ok && r.error.message, p]);
      else if (code !== 'ok' && code !== 'validation') bad.push([code, p]);
      if (!r.ok && !(r.error.message.length > 0 && r.error.message.length < 2000))
        bad.push(['message', r.error]);
      if (r.ok && !Array.isArray((r.value as any).hits)) bad.push(['shape', p]);
    }
    expect(bad.slice(0, 3)).toEqual([]);
  }, 120_000);
});

describe('index rebuild scheduling', () => {
  it('rebuilds in slices, reports progress in order, then ready', async () => {
    const { dir, ws } = setup(10);
    ws.search.markDirty('test');
    const t = mk(dir, undefined, ws);
    expect(t.sched.pending()).toBe(1);
    // while dirty, a search answers 'rebuilding'
    const during = await t.val('search.run', { query: 'alpha' });
    expect(during.state).toBe('rebuilding');
    expect(during.hits).toEqual([]);
    t.sched.drain();
    const s = states(t.events);
    // the initial 'dirty' fires during construction, before any listener can attach
    expect(s[0]!.state).toBe('rebuilding');
    expect(s.at(-1)).toEqual({ type: 'searchState', state: 'ready' });
    const dones = s.flatMap((e) => (e.progress ? [e.progress.done] : []));
    expect(dones.length).toBeGreaterThan(2);
    expect([...dones].sort((a, b) => a - b)).toEqual(dones);
    expect(dones.at(-1)).toBe(10);
    // each state change is emitted once
    expect(new Set(s.map((e) => JSON.stringify(e))).size).toBe(s.length);
    const after = await t.val('search.run', { query: 'alpha' });
    expect(after.state).toBe('ready');
    expect(after.hits).toHaveLength(10);
  });

  it('a search mid-rebuild replies rebuilding with progress; notes written meanwhile are found', async () => {
    const { dir, ws } = setup(10);
    ws.search.markDirty('test');
    const t = mk(dir, undefined, ws);
    t.sched.tick();
    t.sched.tick();
    const mid = await t.val('search.run', { query: 'alpha' });
    expect(mid.state).toBe('rebuilding');
    expect(mid.progress.total).toBeGreaterThan(0);
    const c = await t.val('notes.create', { body: 'alpha written during rebuild' });
    await t.val('notes.save', {
      id: c.id,
      body: 'alpha edited gammaword',
      expectedContentHash: c.contentHash,
    });
    t.sched.drain();
    const done = await t.val('search.run', { query: 'alpha' });
    expect(done.state).toBe('ready');
    expect(done.hits).toHaveLength(11);
    expect((await t.val('search.run', { query: 'gammaword' })).hits).toHaveLength(1);
  });

  it('search.rebuild marks the index dirty, starts the pump and ends ready (main window only)', async () => {
    const { dir, ws } = setup(5);
    ws.search.rebuild();
    const t = mk(dir, undefined, ws);
    expect(t.sched.pending()).toBe(0); // ready: nothing to do
    expect(await t.call('search.rebuild')).toEqual({ ok: true, value: undefined });
    expect(t.sched.pending()).toBe(1);
    expect((await t.val('search.run', { query: 'alpha' })).state).toBe('rebuilding');
    t.sched.drain();
    expect(states(t.events).at(-1)).toEqual({ type: 'searchState', state: 'ready' });
    expect((await t.val('search.run', { query: 'alpha' })).hits).toHaveLength(5);
    expect((CAPTURE_METHODS as readonly string[]).includes('search.rebuild')).toBe(false);
    expect((await t.call('search.rebuild', { x: 1 })).ok).toBe(false); // strict {}
  });

  it('unrecoverable damage: one automatic retry, then an error state that stops the pump until search.rebuild', async () => {
    const { dir, ws } = setup(10);
    ws.search.rebuild();
    ws.close();
    damageShadowPage(join(dir, 'w.db'));
    const r = openWorkspace(join(dir, 'w.db'), { guards: [] }); // the guard would refuse this file
    if (!r.ok) throw new Error(r.error.message);
    unwrapVoid(r.value.search.markDirty('test'));
    const t = mk(dir, undefined, r.value);
    expect(t.sched.pending()).toBe(1);
    t.sched.tick(); // first failure: the pump goes on (the one automatic retry)
    expect(t.sched.pending()).toBe(1);
    expect(states(t.events).at(-1)?.state).not.toBe('error');
    t.sched.tick(); // second failure: error, no more scheduling
    expect(t.sched.pending()).toBe(0);
    const last = states(t.events).at(-1)!;
    expect(last.state).toBe('error');
    expect(last.message).toMatch(/damaged|cannot be rebuilt/);
    expect(await t.val('search.status')).toMatchObject({ state: 'error' });
    // Searching does not restart the pump, and answers with the error state.
    const page = await t.val('search.run', { query: 'alpha' });
    expect(page).toMatchObject({ state: 'error', hits: [] });
    expect(page.messages.join(' ')).toMatch(/damaged|cannot be rebuilt/);
    expect(t.sched.pending()).toBe(0);
    // A manual rebuild re-arms: it schedules again, and fails the same way twice more.
    expect((await t.call('search.rebuild')).ok).toBe(true);
    expect(t.sched.pending()).toBe(1);
    t.sched.drain();
    expect(states(t.events).at(-1)?.state).toBe('error');
    expect(t.sched.pending()).toBe(0);
  });

  it('a save that quarantined the index starts the rebuild pump by itself', async () => {
    const { dir, ws } = setup(5);
    const target = must(ws.notes.create({}, { title: 'target', body: 'alpha seed' }));
    ws.search.rebuild();
    ws.close();
    const db = new Database(join(dir, 'w.db')) as InstanceType<typeof Database> & {
      unsafeMode(on: boolean): void;
    };
    db.unsafeMode(true);
    db.exec('UPDATE note_fts_data SET block = zeroblob(length(block)) WHERE id = 10'); // only writes notice
    db.close();
    const r = openWorkspace(join(dir, 'w.db'));
    if (!r.ok) throw new Error(r.error.message);
    const t = mk(dir, undefined, r.value);
    expect(t.sched.pending()).toBe(0); // looks ready
    await t.val('notes.save', {
      id: target.id,
      body: 'alpha edited gammaword',
      expectedContentHash: target.contentHash,
    });
    expect(t.sched.pending()).toBe(1); // the save quarantined the triggers; the pump was started
    t.sched.drain();
    expect(states(t.events).at(-1)).toEqual({ type: 'searchState', state: 'ready' });
    expect((await t.val('search.run', { query: 'gammaword' })).hits).toHaveLength(1);
  });

  it('stops on close and never steps afterwards', () => {
    const { dir, ws } = setup(10);
    ws.search.markDirty('test');
    let steps = 0;
    const real = ws.search.rebuildStep;
    const counted = {
      ...ws,
      search: {
        ...ws.search,
        rebuildStep: () => {
          steps++;
          return real();
        },
      },
    } as Workspace;
    const t = mk(dir, undefined, counted);
    t.sched.tick();
    const n = states(t.events).length;
    const before = steps;
    expect(t.sched.pending()).toBe(1);
    t.d.close();
    t.sched.drain(); // a queued tick after close must do nothing
    expect(before).toBe(1);
    expect(steps).toBe(before);
    expect(states(t.events).length).toBe(n);
  });

  it('resumes after reopen', async () => {
    const { dir, ws } = setup(10);
    ws.search.markDirty('test');
    const a = mk(dir, undefined, ws);
    a.sched.tick();
    a.sched.tick();
    a.d.close();
    const b = mk(dir);
    expect((await b.val('search.status')).state).toBe('rebuilding');
    b.sched.drain();
    expect(await b.val('search.status')).toEqual({ state: 'ready' });
    expect((await b.val('search.run', { query: 'alpha' })).hits).toHaveLength(10);
  });

  it('never runs when the workspace failed to open', async () => {
    let calls = 0;
    const d = createDispatcher({ ok: false, error: { code: 'corrupt', message: 'bad' } } as any, {
      schedule: () => void calls++,
    });
    const r = await d.handle('search.run', { query: 'a' });
    expect(calls).toBe(0);
    expect(!r.ok && r.error.code).toBe('corrupt');
    expect(JSON.stringify(r)).not.toContain('stack');
  });

  it('a throwing search becomes a plain internal error', async () => {
    const { dir, ws } = setup(1);
    const boom = {
      ...ws,
      search: {
        ...ws.search,
        search: () => {
          throw new Error('secret /path/x');
        },
      },
    } as Workspace;
    const t = mk(dir, undefined, boom);
    const r = await t.call('search.run', { query: 'a' });
    expect(r).toEqual({ ok: false, error: { code: 'internal', message: 'internal error' } });
  });
});

describe('saved searches over rpc', () => {
  it('create, list, rename, delete; no note change events', async () => {
    const { dir, ws } = setup(0);
    ws.search.rebuild();
    const t = mk(dir, undefined, ws);
    const s = await t.val('search.saved.create', {
      name: ' Work ',
      spec: { query: 'alpha', sort: 'updated' },
    });
    expect(s.name).toBe('Work');
    expect(await t.val('search.saved.list')).toHaveLength(1);
    expect((await t.val('search.saved.rename', { id: s.id, name: 'Home' })).name).toBe('Home');
    await t.val('search.saved.delete', { id: s.id });
    expect(await t.val('search.saved.list')).toEqual([]);
    expect(t.events.filter((e) => e.type === 'changed')).toEqual([]);
    const nf = await t.call('search.saved.delete', { id: 'nope' });
    expect(!nf.ok && nf.error.code).toBe('not_found');
  });

  it('validates names, specs and unknown keys', async () => {
    const { dir, ws } = setup(0);
    const t = mk(dir, undefined, ws);
    for (const a of [
      { name: '', spec: { query: 'a' } },
      { name: '   ', spec: { query: 'a' } },
      { name: 'x'.repeat(81), spec: { query: 'a' } },
      { name: 'ok', spec: { query: 'a', limit: 5 } },
      { name: 'ok', spec: { query: 'x'.repeat(1001) } },
      { name: 'ok', spec: { query: 'a' }, extra: 1 },
    ]) {
      const r = await t.call('search.saved.create', a);
      expect(!r.ok && r.error.code, JSON.stringify(a).slice(0, 60)).toBe('validation');
    }
  });

  it('a corrupt value is reported as corrupt until reset', async () => {
    const { dir, ws } = setup(0);
    const t = mk(dir, undefined, ws);
    setMeta(ws.store.db, 'saved_searches', '{not json');
    for (const [m, a] of [
      ['search.saved.list', {}],
      ['search.saved.create', { name: 'x', spec: { query: 'a' } }],
    ] as const) {
      const r = await t.call(m, a);
      expect(!r.ok && r.error.code).toBe('corrupt');
    }
    await t.val('search.saved.reset');
    expect(await t.val('search.saved.list')).toEqual([]);
    expect((await t.val('search.saved.create', { name: 'x', spec: { query: 'a' } })).name).toBe(
      'x',
    );
  });
});
