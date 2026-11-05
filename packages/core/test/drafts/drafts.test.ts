import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../../src/db/hash.ts';
import { createDraftsApi, type Timers } from '../../src/drafts/index.ts';
import { createNotesApi } from '../../src/notes/notes.ts';
import { err } from '../../src/result.ts';
import { unwrap } from '../notes/util.ts';
import { open, tmp } from '../store/helpers.ts';

/** Manual clock + scheduler: time only moves when the test says so. */
function fake() {
  let now = 1000;
  let seq = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout(fn, ms) {
      q.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout: (h) => void q.delete(h as number),
  };
  return {
    clock: { now: () => now },
    timers,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...q.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        q.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}

function setup() {
  const f = fake();
  const s = open(join(tmp(), 'n.db'), { clock: f.clock });
  const h = sha256('');
  s.db
    .prepare(
      `INSERT INTO notes(id,title,body,content_hash,created_at,updated_at,device_id) VALUES ('n1','t','',?,1,1,?)`,
    )
    .run(h, s.deviceId);
  const base = { rev: 1, contentHash: h };
  const drafts = createDraftsApi(s, { timers: f.timers });
  const rows = () =>
    s.db.prepare('SELECT seq, body FROM drafts ORDER BY seq').all() as {
      seq: number;
      body: string;
    }[];
  return { f, s, drafts, base, rows };
}

describe('CS-7 draft journal writer', () => {
  it('writes 300 ms after the last keystroke, not before', () => {
    const { f, drafts, base, rows } = setup();
    drafts.write('n1', 'a', base);
    f.advance(299);
    expect(rows()).toHaveLength(0);
    f.advance(1);
    expect(rows().map((r) => r.body)).toEqual(['a']);
  });

  it('continuous typing is still journaled within 800 ms of the first pending keystroke', () => {
    const { f, drafts, base, rows } = setup();
    let text = '';
    for (let t = 0; t < 790; t += 100) {
      text += 'x';
      drafts.write('n1', text, base);
      f.advance(100);
      if (t < 700) expect(rows()).toHaveLength(0);
    }
    expect(rows().length).toBeGreaterThanOrEqual(1);
    expect(rows().at(-1)!.body.length).toBeGreaterThanOrEqual(8);
  });

  it('every keystroke is in the journal within 800 ms, measured per keystroke', () => {
    const { f, drafts, base, rows } = setup();
    const typedAt: number[] = [];
    const landedAt: (number | undefined)[] = [];
    let text = '';
    // 40 keystrokes, one every 50 ms (continuous typing); then 1 s of quiet. 1 ms steps measure the lag.
    for (let ms = 0; ms < 3000; ms++) {
      if (ms < 2000 && ms % 50 === 0) {
        text += 'x';
        drafts.write('n1', text, base);
        typedAt.push(ms);
      }
      f.advance(1);
      const n = rows().at(-1)?.body.length ?? 0;
      for (let k = 0; k < typedAt.length; k++) if (n > k) landedAt[k] ??= ms + 1;
    }
    const lags = typedAt.map((t, k) => (landedAt[k] ?? Infinity) - t);
    expect(Math.max(...lags)).toBeLessThanOrEqual(800);
  });

  it('keeps only the newest draft per note', () => {
    const { f, drafts, base, rows } = setup();
    drafts.write('n1', 'a', base);
    f.advance(300);
    drafts.write('n1', 'ab', base);
    f.advance(300);
    expect(rows().map((r) => r.body)).toEqual(['ab']);
  });
});

describe('draft cleanup is keyed by seq, never by text', () => {
  it('a draft written after the save survives even when its text equals the saved text', () => {
    const { drafts, base, rows } = setup();
    drafts.write('n1', 'abc', base);
    const seq1 = drafts.flush('n1');
    if (!seq1.ok) throw new Error('flush');
    drafts.write('n1', 'abc', base); // identical text, newer draft
    const seq2 = drafts.flush('n1');
    if (!seq2.ok) throw new Error('flush');
    expect(seq2.value.n1).toBeGreaterThan(seq1.value.n1!);
    expect(drafts.discardUpTo('n1', seq1.value.n1!)).toEqual({ ok: true, value: 0 }); // seq1 already superseded
    expect(rows().map((r) => r.seq)).toEqual([seq2.value.n1]);
    expect(drafts.discardUpTo('n1', seq2.value.n1!)).toEqual({ ok: true, value: 1 });
    expect(rows()).toHaveLength(0);
  });

  it('discardPending drops unwritten text', () => {
    const { f, drafts, base, rows } = setup();
    drafts.write('n1', 'zzz', base);
    drafts.discardPending('n1');
    f.advance(2000);
    expect(rows()).toHaveLength(0);
  });
});

describe('recover()', () => {
  it('surfaces the latest draft; flags a changed base instead of applying or dropping it', () => {
    const { drafts, base, s } = setup();
    drafts.write('n1', 'unsaved', base);
    drafts.flush();
    let r = drafts.recover();
    expect(r.ok && r.value).toMatchObject([
      { noteId: 'n1', body: 'unsaved', baseChanged: false, matchesNote: false },
    ]);
    s.db.prepare("UPDATE notes SET rev = 2, body = 'saved' WHERE id = 'n1'").run();
    r = drafts.recover();
    expect(r.ok && r.value[0]).toMatchObject({ body: 'unsaved', baseChanged: true });
  });

  it('recover(noteId) returns only that note', () => {
    const { drafts, base, s } = setup();
    s.db
      .prepare(
        `INSERT INTO notes(id,title,body,content_hash,created_at,updated_at,device_id) VALUES ('n2','t','',?,1,1,?)`,
      )
      .run(base.contentHash, s.deviceId);
    drafts.write('n1', 'one', base);
    drafts.write('n2', 'two', base);
    drafts.flush();
    const r = drafts.recover('n2');
    expect(r.ok && r.value.map((d) => d.body)).toEqual(['two']);
    const all = drafts.recover();
    expect(all.ok && all.value).toHaveLength(2);
  });

  it('survives a reopen', () => {
    const { s, drafts, base } = setup();
    drafts.write('n1', 'keep', base);
    drafts.flush();
    const path = s.path;
    s.close();
    const s2 = open(path);
    const r = createDraftsApi(s2).recover();
    expect(r.ok && r.value.map((d) => d.body)).toEqual(['keep']);
  });

  // Changed in fix round 2: a note that no longer exists (FK failure) is dropped, not retried forever.
  it('a flush for a vanished note reports through onError once and is then dropped', () => {
    const f = fake();
    const s = open(join(tmp(), 'n.db'), { clock: f.clock });
    const errs: unknown[] = [];
    const d = createDraftsApi(s, { timers: f.timers, onError: (e) => errs.push(e) });
    d.write('missing', 'x', { rev: 1, contentHash: sha256('') }); // FK violation
    f.advance(300);
    expect(errs).toHaveLength(1);
    expect(d.flush()).toEqual({ ok: true, value: {} });
  });

  it('a failed flush of an existing note keeps the text pending and reports through onError', () => {
    const f = fake();
    const s = open(join(tmp(), 'n.db'), { clock: f.clock });
    const n = unwrap(createNotesApi(s).create({}, { title: 't', body: '' }));
    let fail = true;
    const flaky = {
      db: s.db,
      clock: s.clock,
      mutate: ((c, fn) => (fail ? err('io', 'disk full') : s.mutate(c, fn))) as typeof s.mutate,
    };
    const errs: unknown[] = [];
    const d = createDraftsApi(flaky, { timers: f.timers, onError: (e) => errs.push(e) });
    d.write(n.id, 'x', { rev: 1, contentHash: n.contentHash });
    f.advance(300);
    expect(errs).toHaveLength(1);
    expect(d.flush().ok).toBe(false);
    fail = false;
    expect(d.flush().ok).toBe(true);
    expect(unwrap(d.recover())[0]?.body).toBe('x');
  });
});
