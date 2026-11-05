import { afterEach, describe, expect, it } from 'vitest';
import type { RpcResult, SaveReply } from '@mossnote/core/rpc';
import {
  createAutosave,
  type AutosaveOptions,
  type Base,
  type SaveState,
} from '../src/editor/autosave';
import { createClient } from '../src/rpc/client';
import { manualTimers } from './helpers/timers';
import { makeEnv, type Env } from './helpers/workspace';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const ok = <T>(value: T): RpcResult<T> => ({ ok: true, value });
const fail = (code: 'conflict' | 'io' | 'trashed', message: string = code): RpcResult<never> => ({
  ok: false,
  error: { code, message },
});
const reply = (n: number): SaveReply => ({
  rev: n,
  contentHash: String(n).repeat(64).slice(0, 64),
  title: 't',
  updatedAt: n,
});

/** A scripted RPC: saves are resolved by the test, in order. Records instead of asserting. */
function rig(initial = 'base', extra: Partial<AutosaveOptions> = {}) {
  const timers = manualTimers();
  const doc = { text: initial };
  const drafts: { text: string; base: Base }[] = [];
  const saves: { body: string; hash: string; resolve(r: RpcResult<SaveReply>): void }[] = [];
  const states: SaveState[] = [];
  const saved: SaveReply[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const m = createAutosave({
    noteId: 'n1',
    base: { rev: 1, contentHash: H1 },
    initialText: initial,
    getText: () => doc.text,
    writeDraft: async (_id, text, base) => {
      drafts.push({ text, base });
      return ok(undefined);
    },
    save: (_id, body, hash) =>
      new Promise((resolve) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        saves.push({
          body,
          hash,
          resolve: (r) => {
            concurrent--;
            resolve(r);
          },
        });
      }),
    timers,
    onState: (s) => states.push(s),
    onSaved: (r) => saved.push(r),
    ...extra,
  });
  const type = (t: string) => {
    doc.text = t;
    m.change();
  };
  return { m, timers, doc, drafts, saves, states, saved, type, max: () => maxConcurrent };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('autosave machine (pure)', () => {
  it('journals the first change at once and the latest text after the 100 ms throttle, before any save', async () => {
    const r = rig();
    r.type('a');
    r.type('ab');
    r.type('abc');
    await settle();
    expect(r.drafts.map((d) => d.text)).toEqual(['a']); // leading write; the rest is held
    await r.timers.advance(100);
    expect(r.drafts.map((d) => d.text)).toEqual(['a', 'abc']); // trailing write reads the text at send time
    expect(r.saves).toHaveLength(0);
  });

  it('reads the save body at send time through the getter (never a queued copy)', async () => {
    const r = rig();
    r.type('abc');
    r.doc.text = 'abc plus text that never called change()';
    await r.timers.advance(1000);
    expect(r.saves.map((s) => s.body)).toEqual(['abc plus text that never called change()']);
  });

  it('saves after 1 s of quiet, and at 5 s while typing continues (max wait)', async () => {
    const quiet = rig();
    quiet.type('x');
    await quiet.timers.advance(999);
    expect(quiet.saves).toHaveLength(0);
    await quiet.timers.advance(1);
    expect(quiet.saves).toHaveLength(1);

    const busy = rig();
    for (let t = 0; t < 4800; t += 400) {
      busy.type(`k${t}`);
      await busy.timers.advance(400);
    }
    expect(busy.saves).toHaveLength(0); // always < 1 s of quiet, max not reached yet
    busy.type('last');
    await busy.timers.advance(400);
    expect(busy.saves).toHaveLength(1);
  });

  it('keeps one save in flight and re-journals with the NEW base when text changed during it', async () => {
    const r = rig();
    r.type('one');
    await r.timers.advance(1000); // save #1 in flight
    r.type('one two'); // typed during the save
    await r.timers.advance(1000); // timers fire while #1 is still unresolved
    expect(r.saves).toHaveLength(1);
    const before = r.drafts.length;
    r.saves[0]!.resolve(ok(reply(2)));
    await settle();
    // The draft written during the save carried the old base; it is rewritten with rev 2.
    const rewritten = r.drafts.slice(before);
    expect(rewritten.at(-1)).toEqual({
      text: 'one two',
      base: { rev: 2, contentHash: reply(2).contentHash },
    });
    expect(r.states.at(-1)).not.toEqual({ kind: 'saved' });
    // the follow-up save carries the text typed during the first one and the new hash
    expect(r.saves).toHaveLength(2);
    expect(r.saves[1]).toMatchObject({ body: 'one two', hash: reply(2).contentHash });
    r.saves[1]!.resolve(ok(reply(3)));
    await settle();
    expect(r.m.state()).toEqual({ kind: 'saved' });
    expect(r.max()).toBe(1);
  });

  it('text typed during a save, when no follow-up is due yet, shows dirty rather than Saving', async () => {
    const r = rig();
    r.type('one');
    await r.timers.advance(1000); // save in flight
    r.type('one two'); // the save timer is pending again
    r.saves[0]!.resolve(ok(reply(2)));
    await settle();
    expect(r.saves).toHaveLength(1); // no request in flight
    expect(r.m.state()).toEqual({ kind: 'dirty' });
    await r.timers.advance(1000);
    expect(r.saves).toHaveLength(2);
  });

  it('errors, retries manually, and retries automatically on the next edit', async () => {
    const r = rig();
    r.type('x');
    await r.timers.advance(1000);
    r.saves[0]!.resolve(fail('io', 'disk full'));
    await settle();
    expect(r.m.state()).toEqual({ kind: 'error', code: 'io', message: 'disk full' });

    const retry = r.m.retry();
    await settle();
    expect(r.saves).toHaveLength(2);
    r.saves[1]!.resolve(ok(reply(2)));
    await retry;
    expect(r.m.state()).toEqual({ kind: 'saved' });

    r.type('y');
    await r.timers.advance(1000);
    r.saves[2]!.resolve(fail('io', 'again'));
    await settle();
    r.type('yz'); // next edit re-arms the save by itself
    await r.timers.advance(1000);
    expect(r.saves).toHaveLength(4);
  });

  it('a conflict blocks further saves but never stops journaling the text', async () => {
    const r = rig();
    r.type('mine');
    await r.timers.advance(1000);
    r.saves[0]!.resolve(fail('conflict'));
    await settle();
    expect(r.m.state()).toMatchObject({ kind: 'error', code: 'conflict' });
    r.type('mine more');
    await r.timers.advance(10_000);
    await r.m.flushAll();
    expect(r.saves).toHaveLength(1);
    expect(r.drafts.at(-1)?.text).toBe('mine more');
  });

  it('flushAll saves now (no timers) and waits for a save already in flight', async () => {
    const r = rig();
    r.type('x');
    const done = r.m.flushAll();
    await settle();
    expect(r.saves).toHaveLength(1);
    expect(r.timers.pending).toBe(0);
    r.type('xy'); // typed while the flush save is in flight
    r.saves[0]!.resolve(ok(reply(2)));
    await settle();
    r.saves[1]!.resolve(ok(reply(3)));
    await done;
    expect(r.saves.map((s) => s.body)).toEqual(['x', 'xy']);
    expect(r.m.state()).toEqual({ kind: 'saved' });
  });

  it('flushAll resolves (text stays journaled) when the save fails', async () => {
    const r = rig();
    r.type('x');
    const done = r.m.flushAll();
    await settle();
    r.saves[0]!.resolve(fail('io'));
    await done;
    expect(r.m.state()).toMatchObject({ kind: 'error' });
    expect(r.drafts.at(-1)?.text).toBe('x');
  });

  it('a failed draft write surfaces as an error', async () => {
    const timers = manualTimers();
    const states: SaveState[] = [];
    const m = createAutosave({
      noteId: 'n',
      base: { rev: 1, contentHash: H2 },
      initialText: '',
      getText: () => 'x',
      writeDraft: async () => fail('io', 'journal down'),
      save: async () => ok(reply(2)),
      timers,
      onState: (s) => states.push(s),
    });
    m.change();
    await settle();
    expect(states.at(-1)).toEqual({ kind: 'error', code: 'io', message: 'journal down' });
  });
});

// Decision C2: a loopback that holds the save reply while the user keeps typing.
describe('deferred loopback (real workspace)', () => {
  let env: Env | undefined;
  let env2: Env | undefined;
  afterEach(() => {
    env2?.cleanup();
    (env2 ? undefined : env)?.cleanup();
    env = env2 = undefined;
  });

  async function setup() {
    env = makeEnv();
    const client = createClient(env.bridge);
    const created = await client.call('notes.create', { body: 'base' });
    if (!created.ok) throw new Error(created.error.message);
    const note = created.value;
    const timers = manualTimers();
    const doc = { text: 'base' };
    const m = createAutosave({
      noteId: note.id,
      base: { rev: note.rev, contentHash: note.contentHash },
      initialText: 'base',
      getText: () => doc.text,
      writeDraft: (noteId, text, base) => client.call('drafts.write', { noteId, text, base }),
      save: (id, body, expectedContentHash) =>
        client.call('notes.save', { id, body, expectedContentHash }),
      timers,
      onState: () => {},
    });
    const type = (t: string) => {
      doc.text = t;
      m.change();
    };
    return { client, note, timers, m, type };
  }

  it('typing during an in-flight save never loses or duplicates text (crash then recover)', async () => {
    const { client, note, timers, m, type } = await setup();
    const hold = env!.bridge.hold('notes.save');
    type('base one');
    await timers.advance(1000); // save sent, dispatcher ran it, reply held
    expect(hold.waiting).toBe(1);
    type('base one two'); // arrives after the save ran, carries the OLD base
    hold.release();
    await timers.advance(0);
    // crash before the follow-up save: close flushes the journal, as a kill would leave it
    m.dispose();
    env2 = env!.restart();
    const c2 = createClient(env2.bridge);
    const rec = await c2.call('drafts.recover');
    const list = await c2.call('notes.list', {});
    const got = await c2.call('notes.get', { id: note.id });
    expect(rec.ok && rec.value.map((d) => [d.body, d.baseChanged])).toEqual([
      ['base one two', false],
    ]);
    expect(list.ok && list.value).toHaveLength(1); // no duplicate note
    expect(got.ok && got.value.body).toBe('base one'); // the first save landed
    void client;
  });

  it('typing during an in-flight save: the follow-up save lands everything and clears the journal', async () => {
    const { client, note, timers, m, type } = await setup();
    const hold = env!.bridge.hold('notes.save');
    type('base one');
    await timers.advance(1000);
    type('base one two');
    hold.release();
    await timers.advance(0);
    await timers.advance(1000); // follow-up save
    await m.flushAll();
    const got = await client.call('notes.get', { id: note.id });
    const rec = await client.call('drafts.recover');
    expect(got.ok && got.value.body).toBe('base one two');
    expect(rec.ok && rec.value).toEqual([]); // no stale row survives (MAX seq)
    expect(m.state()).toEqual({ kind: 'saved' });
  });

  it('the draft row exists before the save and is gone after', async () => {
    const { client, note, timers, m, type } = await setup();
    type('base typed');
    await new Promise((r) => setTimeout(r, 500)); // core journals after 300 ms quiet
    const before = await client.call('drafts.recover');
    await timers.advance(1000);
    await m.flushAll();
    const after = await client.call('drafts.recover');
    expect(before.ok && before.value.map((d) => [d.noteId, d.body])).toEqual([
      [note.id, 'base typed'],
    ]);
    expect(after.ok && after.value).toEqual([]);
  });
});

describe('autosave: journal throttle, journal errors, dirty (fix round 1)', () => {
  it('every keystroke reaches a journal write within 100 ms (core adds at most 800 ms, tested in core)', async () => {
    const r = rig();
    const sent: { len: number; at: number }[] = [];
    const push = r.drafts.push.bind(r.drafts);
    r.drafts.push = (d) => (sent.push({ len: d.text.length, at: r.timers.now }), push(d));
    const typedAt: number[] = [];
    for (let i = 1; i <= 300; i++) {
      typedAt.push(r.timers.now);
      r.type('x'.repeat(i)); // keystroke i makes the text i characters long
      await r.timers.advance(10);
    }
    await r.timers.advance(200);
    // per keystroke: the first write that CONTAINS it (a longer or equal text) and was sent after it
    const lags = typedAt.map((t, k) => {
      const w = sent.find((s) => s.len >= k + 1 && s.at >= t);
      return w ? w.at - t : Infinity;
    });
    expect(Math.max(...lags)).toBeLessThanOrEqual(100);
    expect(sent.at(-1)?.len).toBe(300); // the last keystroke is journaled
    expect(r.drafts.length).toBeLessThanOrEqual(35); // ~3000 ms / 100 ms, not 300 writes
  });

  it('a keystroke reads no text; getText runs once per journal send', async () => {
    let reads = 0;
    const r = rig('base', { getText: () => (reads++, r.doc.text) });
    for (let i = 0; i < 50; i++) {
      r.doc.text = `x${i}`;
      r.m.change();
    }
    expect(reads).toBe(1); // only the leading journal write
    await r.timers.advance(100);
    expect(reads).toBe(2); // the trailing write
  });

  it('state is dirty while the timer is pending and saving only while a request is in flight', async () => {
    const r = rig();
    r.type('x');
    expect(r.m.state()).toEqual({ kind: 'dirty' });
    await r.timers.advance(1000);
    expect(r.m.state()).toEqual({ kind: 'saving' });
    r.saves[0]!.resolve(ok(reply(2)));
    await settle();
    expect(r.m.state()).toEqual({ kind: 'saved' });
  });

  it('dirty() reports text that differs from the saved text; flushAll journals text typed during its final wait', async () => {
    const release: (() => void)[] = [];
    const sent: string[] = [];
    const r = rig('base', {
      writeDraft: (_id, text) => {
        sent.push(text);
        return new Promise((res) => release.push(() => res(ok(undefined))));
      },
    });
    r.type('A1'); // its journal write stays unanswered
    const done = r.m.flushAll();
    await settle();
    r.saves[0]!.resolve(ok(reply(2)));
    await settle(); // flushAll now waits for the journal write
    r.type('A12'); // typed during that final wait
    release.splice(0).forEach((f) => f());
    await settle();
    r.saves[1]?.resolve(ok(reply(3)));
    release.splice(0).forEach((f) => f());
    await settle();
    release.splice(0).forEach((f) => f());
    await done;
    expect(r.saves.map((s) => s.body)).toEqual(['A1', 'A12']); // a further round saved it
    expect(r.m.dirty()).toBe(false);
    expect(sent[0]).toBe('A1');
    const failing = rig();
    failing.type('lost?');
    const f = failing.m.flushAll();
    await settle();
    failing.saves[0]!.resolve(fail('io'));
    await f;
    expect(failing.m.dirty()).toBe(true);
    expect(failing.drafts.at(-1)?.text).toBe('lost?'); // still journaled
  });

  it('a journal failure keeps the status an error through a successful save, until a journal write succeeds', async () => {
    let flushOk = false;
    const r = rig('base', {
      flushDrafts: async () => (flushOk ? ok({}) : fail('io', 'journal still broken')),
    });
    r.type('a');
    r.m.fail('journal broke');
    expect(r.m.state()).toMatchObject({ kind: 'error', message: 'journal broke' });
    await r.timers.advance(1000);
    r.saves[0]!.resolve(ok(reply(2)));
    await settle();
    expect(r.states.at(-1)).toMatchObject({ kind: 'error', message: 'journal broke' }); // never 'saved'
    r.type('ab'); // a journal write whose flush still fails
    await r.timers.advance(100);
    await settle();
    expect(r.m.state().kind).toBe('error');
    flushOk = true;
    r.type('abc');
    await r.timers.advance(100);
    await settle();
    expect(r.m.state().kind).toBe('dirty'); // cleared by a journal write that reached disk
    expect(r.states.at(-1)?.kind).toBe('dirty');
  });
});
