// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDispatcher } from '@mossnote/core';
import type { RpcEvent } from '@mossnote/core/rpc';
import { App } from '../src/app/App';
import type { AppModel } from '../src/app/model';
import { createEditor, type EditorHandle } from '../src/editor/createEditor';
import type { EditorFactory } from '../src/editor/EditorPane';
import {
  byText,
  click,
  fakeEditorFactory,
  mount,
  press,
  settle,
  waitFor,
  type Mounted,
} from './helpers/dom';
import { createLoopback } from './helpers/loopback';
import { manualTimers } from './helpers/timers';
import { makeEnv, type Env } from './helpers/workspace';

let env: Env | undefined;
let env2: Env | undefined;
let m: Mounted | undefined;
afterEach(async () => {
  await m?.unmount();
  env2?.cleanup();
  if (!env2) env?.cleanup();
  m = env = env2 = undefined;
});

const options = () => [...document.querySelectorAll<HTMLElement>('[role=option]')];
const titles = () => options().map((o) => o.textContent);
const status = () => document.querySelector('footer')!.textContent ?? '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Booted {
  timers: ReturnType<typeof manualTimers>;
  fake: ReturnType<typeof fakeEditorFactory>;
  model: () => AppModel;
  type(text: string): Promise<void>;
  advance(ms: number): Promise<void>;
}
async function boot(e: Env, factory?: EditorFactory): Promise<Booted> {
  const timers = manualTimers();
  const fake = fakeEditorFactory();
  let model: AppModel | undefined;
  m = await mount(
    <App
      bridge={e.bridge}
      timers={timers}
      createEditor={factory ?? fake.factory}
      onReady={(x) => (model = x)}
    />,
  );
  await waitFor(
    () =>
      options().length > 0 || /No notes yet|Couldn’t load/.test(document.body.textContent ?? ''),
    'list',
  );
  return {
    timers,
    fake,
    model: () => model!,
    type: (t) => act(async () => fake.type(t)),
    advance: (ms) => act(async () => void (await timers.advance(ms))),
  };
}
async function seed(e: Env, ...bodies: string[]) {
  const ids: string[] = [];
  for (const body of bodies) {
    const r = await e.bridge.rpc('notes.create', { body });
    if (!r.ok) throw new Error('seed failed');
    ids.push((r.value as { id: string }).id);
  }
  return ids;
}
const openRow = async (i: number) => {
  await click(options()[i]);
  await waitFor(
    () => document.querySelector('.editor-host')?.hasAttribute('hidden') === false,
    'editor',
  );
};

describe('boot', () => {
  it('shows a fatal screen with Quit when the workspace did not open', async () => {
    const d = createDispatcher({ ok: false, error: { code: 'corrupt', message: 'db damaged' } });
    let quit = 0;
    m = await mount(<App bridge={createLoopback(d)} onQuit={() => quit++} />);
    await waitFor(() => /db damaged/.test(document.body.textContent ?? ''), 'fatal screen');
    expect(document.querySelector('[role=alert]')?.textContent).toBe('db damaged');
    expect(document.querySelector('[role=separator]')).toBeNull(); // no shell
    await click(byText(document.body, 'Quit'));
    expect(quit).toBe(1);
  });
});

describe('note list states', () => {
  it('empty: "No notes yet" and New note creates and opens a note', async () => {
    env = makeEnv();
    const b = await boot(env);
    expect(document.body.textContent).toContain('No notes yet');
    await click(byText(document.body, 'New note'));
    await waitFor(() => options().length === 1, 'new row');
    expect(options()[0]!.textContent).toBe('Untitled');
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(b.fake.state.created).toBe(1); // exactly one editor, ever
  });

  it('loading text appears only after 150 ms', async () => {
    env = makeEnv();
    const hold = env.bridge.hold('notes.list');
    const timers = manualTimers();
    m = await mount(
      <App bridge={env.bridge} timers={timers} createEditor={fakeEditorFactory().factory} />,
    );
    await waitFor(() => env!.bridge.count('notes.list') === 1, 'list request');
    await act(async () => void (await timers.advance(149)));
    expect(document.body.textContent).not.toContain('Loading notes');
    await act(async () => void (await timers.advance(1)));
    expect(document.body.textContent).toContain('Loading notes');
    hold.release();
    await waitFor(() => /No notes yet/.test(document.body.textContent ?? ''), 'empty');
    expect(document.body.textContent).not.toContain('Loading notes');
  });

  it('error: shows the message and Retry loads the list', async () => {
    env = makeEnv();
    await seed(env, 'Alpha');
    env.bridge.inject('notes.list', {
      ok: false,
      error: { code: 'io', message: 'disk unplugged' },
    });
    await boot(env);
    expect(document.querySelector('[role=alert]')?.textContent).toContain('disk unplugged');
    await click(byText(document.body, 'Retry'));
    await waitFor(() => options().length === 1, 'list after retry');
    expect(titles()).toEqual(['Alpha']);
    expect(document.querySelector('[role=alert]')).toBeNull();
  });

  it('listbox keyboard: roving tabindex, arrows, Home/End, Enter opens and focuses the editor', async () => {
    env = makeEnv();
    await seed(env, 'One', 'Two', 'Three');
    const b = await boot(env);
    const tabbable = () =>
      options()
        .filter((o) => o.tabIndex === 0)
        .map((o) => o.textContent);
    expect(options()[0]!.parentElement!.getAttribute('role')).toBe('listbox');
    expect(tabbable()).toHaveLength(1);
    const ul = options()[0]!.parentElement!;
    const first = titles()[0];
    await press(options()[0]!, 'ArrowDown');
    expect(tabbable()).toEqual([titles()[1]]);
    await press(options()[1]!, 'End');
    expect(tabbable()).toEqual([titles()[2]]);
    await press(options()[2]!, 'Home');
    expect(tabbable()).toEqual([first]);
    let focused = 0;
    b.model().hooks.focusEditor = () => focused++;
    await press(options()[1]!, 'Enter');
    await waitFor(() => options()[1]!.getAttribute('aria-selected') === 'true', 'selected');
    expect(focused).toBe(1);
    expect(ul.querySelectorAll('[aria-selected=true]')).toHaveLength(1);
  });
});

describe('editor pane', () => {
  it('opens a note into the single editor and shows the empty prompt when nothing is open', async () => {
    env = makeEnv();
    await seed(env, '# Hello\nbody');
    const b = await boot(env);
    expect(document.body.textContent).toContain('Select or create a note');
    await openRow(0);
    expect(b.fake.state.text).toBe('# Hello\nbody');
    expect(b.fake.state.created).toBe(1);
  });

  it('shows "Couldn\'t open note" with Retry', async () => {
    env = makeEnv();
    await seed(env, 'x');
    const b = await boot(env);
    env.bridge.inject('notes.get', { ok: false, error: { code: 'io', message: 'read failed' } });
    await click(options()[0]);
    await waitFor(() => /Couldn’t open note/.test(document.body.textContent ?? ''), 'error');
    await click(byText(document.body, 'Retry'));
    await waitFor(() => b.fake.state.text === 'x', 'note after retry');
  });

  it('autosave: typing shows Unsaved changes, then Saved; the row title follows the text', async () => {
    env = makeEnv();
    await seed(env, 'Old title');
    const b = await boot(env);
    await openRow(0);
    await b.type('New title\nmore');
    expect(status()).toContain('Unsaved changes'); // timer pending, nothing in flight
    expect(status()).not.toContain('Saving…');
    await b.advance(1000);
    expect(status()).toContain('Saved');
    expect(titles()).toEqual(['New title']);
    const got = await env.bridge.rpc('notes.get', { id: options()[0]!.dataset.id });
    expect(got).toMatchObject({ ok: true, value: { body: 'New title\nmore' } });
  });

  it('switching notes lands the old note first', async () => {
    env = makeEnv();
    const [a, bId] = await seed(env, 'A', 'B');
    const b = await boot(env);
    const rowFor = (id: string) => options().find((o) => o.dataset.id === id)!;
    await click(rowFor(a!));
    await waitFor(() => b.fake.state.text === 'A', 'A open');
    await b.type('A edited');
    await click(rowFor(bId!)); // no timer advance: the switch itself must flush
    await waitFor(() => b.fake.state.text === 'B', 'B open');
    const got = await env.bridge.rpc('notes.get', { id: a });
    expect(got).toMatchObject({ ok: true, value: { body: 'A edited' } });
  });

  it('a failed save on switch keeps the text in the journal and flags it as Unsaved changes', async () => {
    env = makeEnv();
    const [a, bId] = await seed(env, 'A', 'B');
    const b = await boot(env);
    const rowFor = (id: string) => options().find((o) => o.dataset.id === id)!;
    await click(rowFor(a!));
    await waitFor(() => b.fake.state.text === 'A', 'A open');
    await b.type('A precious text');
    env.bridge.inject('notes.save', { ok: false, error: { code: 'io', message: 'no space' } });
    await click(rowFor(bId!));
    await waitFor(() => b.fake.state.text === 'B', 'B open');
    expect(document.querySelector('[aria-label="Unsaved changes"]')?.textContent).toContain(
      'A precious text'.slice(0, 15),
    );
    // after a restart the journal still has it
    await m!.unmount();
    env2 = env.restart();
    const rec = await env2.bridge.rpc('drafts.recover', {});
    expect(rec).toMatchObject({ ok: true, value: [{ noteId: a, body: 'A precious text' }] });
    env = undefined;
  });

  it('Delete in the list saves the open note before trashing it', async () => {
    env = makeEnv();
    await seed(env, 'Keep me');
    const b = await boot(env);
    await openRow(0);
    await b.type('Keep me, edited');
    const id = options()[0]!.dataset.id!;
    await press(options()[0]!, 'Delete');
    await waitFor(() => options().length === 0, 'row gone');
    const order = env.bridge.calls
      .map((c) => c.method)
      .filter((x) => /notes\.(save|trash)/.test(x));
    expect(order).toEqual(['notes.save', 'notes.trash']);
    const got = await env.bridge.rpc('notes.get', { id });
    expect(got).toMatchObject({ ok: true, value: { body: 'Keep me, edited', trashed: true } });
  });
});

describe('save status', () => {
  it('announces only errors and the recovery from one, and shows a static sync label', async () => {
    env = makeEnv();
    await seed(env, 'x');
    const b = await boot(env);
    await openRow(0);
    const live = () => document.querySelector('footer [role=status]')!;
    expect(live().getAttribute('aria-live')).toBe('polite');
    await b.type('x1');
    expect(status()).toContain('Unsaved changes');
    expect(live().textContent).toBe(''); // no chatter
    env.bridge.inject('notes.save', { ok: false, error: { code: 'io', message: 'disk full' } });
    await b.advance(1000);
    expect(live().textContent).toContain('disk full');
    expect(byText(document.body, 'Retry')).toBeDefined();
    await click(byText(document.body, 'Retry'));
    await waitFor(() => status().includes('Saved'), 'saved');
    expect(live().textContent).toBe('Saved');
    await b.type('x12');
    await b.advance(1000);
    expect(live().textContent).toBe(''); // plain saves stay silent
    expect(status()).toContain('Sync: Not paired');
    expect(document.querySelector('footer button[aria-label*=Sync]')).toBeNull(); // text, not a control
  });

  it('a draftError event for the open note shows an error', async () => {
    env = makeEnv();
    const [id] = await seed(env, 'x');
    await boot(env);
    await openRow(0);
    await act(async () =>
      env!.bridge.emit({ type: 'draftError', noteId: id!, message: 'journal broke' }),
    );
    expect(status()).toContain('journal broke');
  });
});

describe('conflict', () => {
  it('offers keep-as-new-note and show-saved-version, never a discard, and keeps the text journaled', async () => {
    env = makeEnv();
    const [id] = await seed(env, 'v1');
    const b = await boot(env);
    await openRow(0);
    // another window saves a new version behind the editor
    const cur = await env.bridge.rpc('notes.get', { id });
    const hash = (cur as { value: { contentHash: string } }).value.contentHash;
    await env.bridge.rpc('notes.save', {
      id,
      body: 'v2 from elsewhere',
      expectedContentHash: hash,
    });
    await b.type('my local text');
    await b.advance(1000);
    const banner = () => document.querySelector('[aria-label="Note changed elsewhere"]');
    expect(banner()).not.toBeNull();
    expect(status()).toContain('changed elsewhere');
    const labels = [...banner()!.querySelectorAll('button')].map((x) => x.textContent);
    expect(labels).toEqual(['Keep my text as a new note', 'Show the saved version']);
    expect(labels.join()).not.toMatch(/discard|reload|overwrite/i);
    expect(b.fake.state.text).toBe('my local text'); // the editor is untouched
    await click(byText(banner()!, 'Show the saved version'));
    expect(banner()!.querySelector('pre')?.textContent).toBe('v2 from elsewhere');
    expect(b.fake.state.text).toBe('my local text');
    await sleep(450); // core journals after 300 ms
    const rec = await env.bridge.rpc('drafts.recover', {});
    expect(rec).toMatchObject({ ok: true, value: [{ noteId: id, body: 'my local text' }] });
    // further typing does not retry the save into the conflict
    await b.type('my local text 2');
    await b.advance(10_000);
    expect(env.bridge.count('notes.save')).toBe(2); // the other window's + the one that conflicted

    await click(byText(banner()!, 'Keep my text as a new note'));
    await waitFor(() => options().length === 2, 'new note row');
    await waitFor(() => b.fake.state.text === 'my local text 2', 'new note open');
    const old = await env.bridge.rpc('notes.get', { id });
    expect(old).toMatchObject({ ok: true, value: { body: 'v2 from elsewhere' } }); // untouched
    expect(banner()).toBeNull();
    const rec2 = await env.bridge.rpc('drafts.recover', {});
    expect(rec2).toMatchObject({ ok: true, value: [] });
  });
});

describe('trashed notes', () => {
  it('a save into a trashed note turns the editor read-only; Restore re-enables it and saves the text', async () => {
    env = makeEnv();
    const [id] = await seed(env, 'v1');
    const b = await boot(env);
    await openRow(0);
    await env.bridge.rpc('notes.trash', { id });
    await b.type('typed before the trash was noticed');
    await b.advance(1000);
    expect(b.fake.state.readOnly).toBe(true);
    expect(document.querySelector('[aria-label="Trashed note"]')).not.toBeNull();
    expect(status()).toContain('Trash');
    b.fake.type('ignored: read-only'); // a read-only editor produces no change
    expect(b.fake.state.text).toBe('typed before the trash was noticed');

    await click(byText(document.body, 'Restore note'));
    await waitFor(() => !b.fake.state.readOnly, 'editable again');
    // the text typed before the trash comes back from the journal (banner); the first edit saves it
    await waitFor(() => b.fake.state.text === 'typed before the trash was noticed', 'journal text');
    expect(document.querySelector('[aria-label="Unsaved text"]')).not.toBeNull();
    await b.type('typed before the trash was noticed!');
    await b.advance(1000);
    await waitFor(() => status().includes('Saved'), 'saved');
    const got = await env.bridge.rpc('notes.get', { id });
    expect(got).toMatchObject({
      ok: true,
      value: { body: 'typed before the trash was noticed!', trashed: false },
    });
    expect(document.querySelector('[aria-label="Trashed note"]')).toBeNull();
  });

  it('opening a trashed note is read-only with Restore', async () => {
    env = makeEnv();
    const [id] = await seed(env, 'in the bin');
    const b = await boot(env);
    await env.bridge.rpc('notes.trash', { id });
    b.model().openNote(id!);
    await waitFor(() => b.fake.state.text === 'in the bin', 'opened');
    expect(b.fake.state.readOnly).toBe(true);
    expect(byText(document.body, 'Restore note')).toBeDefined();
    await b.advance(5000);
    expect(env.bridge.count('notes.save')).toBe(0); // nothing saves into a trashed note
    await click(byText(document.body, 'Restore note'));
    await waitFor(() => !b.fake.state.readOnly, 'editable');
    expect(document.querySelector('[aria-label="Trashed note"]')).toBeNull();
  });
});

describe('quit handshake and restart persistence (CS-12)', () => {
  /** The real CodeMirror editor, with the handle captured so the test can type into it. */
  function realEditor() {
    const h: { current?: EditorHandle } = {};
    const factory: EditorFactory = (p, o) => (h.current = createEditor(p, o));
    const typeInto = (text: string) =>
      act(async () => {
        const v = h.current!.view;
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
      });
    return { factory, typeInto, h };
  }

  it('flushRequest saves the open note, then answers app.flushed; the text survives a restart', async () => {
    env = makeEnv();
    await seed(env, 'start');
    const ed = realEditor();
    const b = await boot(env, ed.factory);
    await click(options()[0]);
    await waitFor(() => ed.h.current?.getText() === 'start', 'note loaded');
    await ed.typeInto('Typed right before quit\nline two');
    // no timer has fired: the only way this reaches disk is the handshake
    const ev: RpcEvent = { type: 'flushRequest', token: 'tok-1' };
    await act(async () => env!.bridge.emit(ev));
    await waitFor(() => env!.bridge.count('app.flushed') === 1, 'app.flushed');
    const calls = env.bridge.calls.map((c) => c.method);
    expect(calls.indexOf('notes.save')).toBeGreaterThan(-1);
    expect(calls.indexOf('notes.save')).toBeLessThan(calls.indexOf('app.flushed'));
    expect(env.bridge.calls.find((c) => c.method === 'app.flushed')?.args).toEqual({
      token: 'tok-1',
    });
    await m!.unmount();
    env2 = env.restart();
    const list = await env2.bridge.rpc('notes.list', {});
    const id = (list as { value: { id: string }[] }).value[0]!.id;
    const got = await env2.bridge.rpc('notes.get', { id });
    expect(got).toMatchObject({ ok: true, value: { body: 'Typed right before quit\nline two' } });
    void b;
  });

  it('text typed with no save at all is recovered and restorable after a restart', async () => {
    env = makeEnv();
    const [id] = await seed(env, 'start');
    const ed = realEditor();
    await boot(env, ed.factory);
    await click(options()[0]);
    await waitFor(() => ed.h.current?.getText() === 'start', 'note loaded');
    await ed.typeInto('only in the journal');
    await sleep(100); // drafts.write is on its way; core coalesces
    await m!.unmount();
    env2 = env.restart(); // dispatcher.close() flushes the journal; the note body was never saved
    const got = await env2.bridge.rpc('notes.get', { id });
    expect(got).toMatchObject({ ok: true, value: { body: 'start' } });

    const ed2 = realEditor();
    await boot(env2, ed2.factory);
    await waitFor(
      () => !!document.querySelector('[aria-label="Recovered text"]'),
      'recovery prompt',
    );
    await click(byText(document.body, 'Restore'));
    await waitFor(() => ed2.h.current?.getText() === 'only in the journal', 'text restored');
  });
});

describe('startup recovery for all recoverable drafts', () => {
  it('lists every note with unsaved text; Restore, Restore as new note, Discard, and silent cleanup', async () => {
    env = makeEnv();
    const [a, bId, c, d] = await seed(env, 'A body', 'B body', 'C body', 'D body');
    const get = async (id: string) =>
      (await env!.bridge.rpc('notes.get', { id })) as {
        value: { rev: number; contentHash: string };
      };
    const draft = async (id: string, text: string) => {
      const n = await get(id);
      await env!.bridge.rpc('drafts.write', {
        noteId: id,
        text,
        base: { rev: n.value.rev, contentHash: n.value.contentHash },
      });
    };
    await draft(a!, 'A typed'); // restorable into A
    await draft(bId!, 'B typed'); // base will change: restore as a new note
    await draft(c!, 'C typed'); // will be discarded
    await draft(d!, 'D body'); // equals the saved note: nothing to recover
    // restart flushes the journal; then B is trashed, so its draft's base is no longer valid
    env2 = env.restart();
    await env2.bridge.rpc('notes.trash', { id: bId });
    const b = await boot(env2);
    const section = () => document.querySelector('[aria-label="Recovered text"]')!;
    await waitFor(() => !!document.querySelector('[aria-label="Recovered text"]'), 'prompt');
    const items = () => [...section().querySelectorAll('li')].map((l) => l.textContent ?? '');
    expect(items()).toHaveLength(3);
    expect(items().join('|')).toContain('A typed');
    expect(items().join('|')).toContain('B typed');
    expect(items().join('|')).toContain('C typed');
    expect(items().join('|')).not.toContain('D body');
    expect(document.querySelector('[aria-label="Unsaved changes"]')?.textContent).toContain(
      'A typed',
    );
    const row = (t: string) =>
      [...section().querySelectorAll('li')].find((l) => l.textContent!.includes(t))!;

    await click(byText(row('C typed'), 'Discard'));
    await waitFor(() => items().length === 2, 'discarded');

    await click(byText(row('B typed'), 'Restore as new note'));
    await waitFor(() => b.fake.state.text === 'B typed', 'new note opened');
    const all = (await env2.bridge.rpc('notes.list', {})) as {
      value: { id: string; title: string }[];
    };
    expect(all.value).toHaveLength(4); // A, C, D and the new copy of B; B itself stays in the Trash
    const bNow = await env2.bridge.rpc('notes.get', { id: bId });
    expect(bNow).toMatchObject({ ok: true, value: { body: 'B body', trashed: true } }); // never overwritten

    await click(byText(row('A typed'), 'Restore'));
    await waitFor(() => b.fake.state.text === 'A typed', 'A restored into the editor');
    await b.advance(5000);
    expect(env2.bridge.count('notes.save')).toBe(0); // opening saves nothing; the first edit does
    await b.type('A typed!');
    await b.advance(1000);
    await waitFor(() => status().includes('Saved'), 'A saved');
    const aNow = await env2.bridge.rpc('notes.get', { id: a });
    expect(aNow).toMatchObject({ ok: true, value: { body: 'A typed!' } });
    expect(document.querySelector('[aria-label="Recovered text"]')).toBeNull();
    // D (silent), C (Discard), B (copied to a new note) and A (saved) all left the journal
    const rec = (await env2.bridge.rpc('drafts.recover', {})) as { value: unknown[] };
    expect(rec.value).toEqual([]);
  });
});

describe('10k notes (performance guard)', () => {
  it('own saves patch one row and never refetch the list; arrow keys touch two rows', async () => {
    env = makeEnv();
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const r = env.ws.notes.create({}, { title: `Note ${i}`, body: `Note ${i}`, folderId: null });
      if (!r.ok) throw new Error(r.error.message);
    }
    const b = await boot(env);
    for (let i = 0; i < 40 && b.model().store.get().hasMore; i++)
      await click(byText(document.body, 'Load more'));
    expect(options()).toHaveLength(N);

    await openRow(0);
    const listCalls = env.bridge.count('notes.list');
    const firstId = options()[0]!.dataset.id!;
    const mutated = new Set<Node>();
    const obs = new MutationObserver((rs) => rs.forEach((r) => mutated.add(r.target)));
    obs.observe(document.querySelector('[role=listbox]')!, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    await b.type('Renamed by autosave');
    await b.advance(1000);
    await waitFor(() => status().includes('Saved'), 'saved');
    await settle(20);
    obs.disconnect();
    expect(env.bridge.count('notes.save')).toBe(1);
    expect(env.bridge.count('notes.list')).toBe(listCalls); // zero refetches
    expect(options()).toHaveLength(N);
    expect(options()[0]!.dataset.id).toBe(firstId); // the row did not jump
    expect(options()[0]!.textContent).toBe('Renamed by autosave');
    expect(mutated.size).toBeLessThanOrEqual(2); // one row (li + its text node)

    // A structural change still refetches (so the counter above can really move).
    await act(async () => env!.bridge.emit({ type: 'changed', entity: 'note', ids: ['x'] }));
    await waitFor(() => env!.bridge.count('notes.list') > listCalls, 'structural refetch');

    const touched = new Set<Node>();
    const obs2 = new MutationObserver((rs) => rs.forEach((r) => touched.add(r.target)));
    obs2.observe(document.querySelector('[role=listbox]')!, {
      subtree: true,
      attributes: true,
      childList: true,
    });
    for (let i = 0; i < 5; i++)
      await press(
        options().find((o) => o.tabIndex === 0)!,
        'ArrowDown',
      );
    await settle(10);
    obs2.disconnect();
    expect(touched.size).toBeLessThanOrEqual(6); // 5 presses: <= 2 rows each, rows overlap
    expect(touched.size).toBeGreaterThan(0);
  }, 120_000);
});
