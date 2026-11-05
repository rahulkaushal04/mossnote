// @vitest-environment jsdom
// Fix round 1 for app-shell: B1/B2 (data loss), M-b (typing cost), M-c (toolbar) and the minors.
import { act, StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { createEditor, type EditorHandle } from '../src/editor/createEditor';
import type { EditorFactory } from '../src/editor/EditorPane';
import { fakeEditorFactory, byText, click, mount, press, settle, waitFor } from './helpers/dom';
import { bootApp, noteOptions, runAxe, seed, serious, text, type Booted } from './helpers/app';
import { manualTimers } from './helpers/timers';
import { makeEnv, type Env } from './helpers/workspace';

let env: Env | undefined;
let env2: Env | undefined;
let b: Booted | undefined;
afterEach(async () => {
  await b?.m.unmount();
  (env2 ?? env)?.cleanup();
  b = env = env2 = undefined;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = () => document.querySelector('footer')!.textContent ?? '';
const section = (label: string) => document.querySelector(`[aria-label="${label}"]`);
const rowFor = (id: string) => noteOptions().find((o) => o.dataset.id === id)!;
const advance = (ms: number) => act(async () => void (await b!.timers.advance(ms)));
const getNote = async (e: Env, id: string) =>
  (
    (await e.bridge.rpc('notes.get', { id })) as {
      value: { body: string; folderId: string | null; rev: number; contentHash: string };
    }
  ).value;
const recover = async (e: Env) => {
  await e.bridge.rpc('drafts.flush', {});
  return (
    (await e.bridge.rpc('drafts.recover', {})) as { value: { noteId: string; body: string }[] }
  ).value;
};
async function journal(e: Env, id: string, body: string) {
  const n = await getNote(e, id);
  await e.bridge.rpc('drafts.write', {
    noteId: id,
    text: body,
    base: { rev: n.rev, contentHash: n.contentHash },
  });
}
const opened = (id: string) => () => b!.model().store.get().openId === id;

describe('B1: journaled text is shown when a note is opened', () => {
  async function setup() {
    env = makeEnv();
    const [a, other] = await seed(env, 'A saved body', 'B saved body');
    await journal(env, a!, 'A journal text');
    env2 = env.restart(); // flushes the journal
    b = await bootApp(env2, { ready: () => !!section('Recovered text') });
    return { a: a!, other: other! };
  }

  it('a note named in the Recovered text banner opens WITH the journal text; typing and saving keep it', async () => {
    const { a } = await setup();
    await click(rowFor(a));
    await waitFor(() => b!.fake.state.text === 'A journal text', 'journal text in the editor');
    expect(section('Unsaved text')?.textContent).toContain('Showing unsaved text from');
    await act(async () => b!.fake.type('A journal text, plus typing'));
    await advance(1000);
    await waitFor(() => status().includes('Saved'), 'saved');
    expect((await getNote(env2!, a)).body).toBe('A journal text, plus typing');
    expect(section('Unsaved text')).toBeNull(); // the journal rows went with the save
    expect(section('Recovered text')).toBeNull(); // and the stale recovery entry with them
    expect(await recover(env2!)).toEqual([]);
  });

  it('after "Decide later" the note still opens with its journal text', async () => {
    const { a } = await setup();
    await click(byText(document.body, 'Decide later'));
    expect(section('Recovered text')).toBeNull();
    await click(rowFor(a));
    await waitFor(() => b!.fake.state.text === 'A journal text', 'journal text in the editor');
    // not typing and not saving yet: the journal row is still there
    expect((await recover(env2!)).map((d) => d.body)).toEqual(['A journal text']);
    expect((await getNote(env2!, a)).body).toBe('A saved body');
  });

  it('the Unsaved changes button after a failed save on switch reopens the note with its text', async () => {
    env = makeEnv();
    const [a, other] = await seed(env, 'A', 'B');
    b = await bootApp(env);
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'A', 'A');
    await act(async () => b!.fake.type('A precious text'));
    env.bridge.inject('notes.save', { ok: false, error: { code: 'io', message: 'no space' } });
    await click(rowFor(other!));
    await waitFor(() => b!.fake.state.text === 'B', 'B');
    await click(byText(section('Unsaved changes')!, 'A precious text'));
    await waitFor(() => b!.fake.state.text === 'A precious text', 'A reopened with its text');
    expect(section('Unsaved text')).not.toBeNull();
    await act(async () => b!.fake.type('A precious text!'));
    await advance(1000);
    await waitFor(() => status().includes('Saved'), 'saved');
    expect((await getNote(env, a!)).body).toBe('A precious text!');
  });

  it('journal text whose base changed opens too and goes through the conflict flow (nothing overwritten)', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'v1');
    const n = await getNote(env, a!);
    await env.bridge.rpc('notes.save', {
      id: a,
      body: 'v2 elsewhere',
      expectedContentHash: n.contentHash,
    });
    // typed against v1, journaled after the other window saved v2 (a save would have dropped older rows)
    await env.bridge.rpc('drafts.write', {
      noteId: a,
      text: 'mine',
      base: { rev: n.rev, contentHash: n.contentHash },
    });
    env2 = env.restart();
    b = await bootApp(env2, { ready: () => !!section('Recovered text') });
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'mine', 'journal text');
    await act(async () => b!.fake.type('mine!')); // opening saves nothing; the first edit does
    await advance(1000);
    await waitFor(() => !!section('Note changed elsewhere'), 'conflict banner');
    expect((await getNote(env2, a!)).body).toBe('v2 elsewhere');
    expect((await recover(env2)).map((d) => d.body)).toEqual(['mine!']);
  });

  it('"Use saved version" needs a confirmation; cancel keeps the text, confirm drops the journal rows', async () => {
    const { a } = await setup();
    await click(rowFor(a));
    await waitFor(() => b!.fake.state.text === 'A journal text', 'journal text');
    await click(byText(document.body, 'Use saved version'));
    expect(document.querySelector('[role=alertdialog]')).not.toBeNull();
    await click(byText(document.querySelector('[role=alertdialog]')!, 'Cancel'));
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
    expect(b!.fake.state.text).toBe('A journal text');
    expect((await recover(env2!)).length).toBe(1);
    await click(byText(document.body, 'Use saved version'));
    await click(byText(document.querySelector('[role=alertdialog]')!, 'Discard unsaved text'));
    await waitFor(() => b!.fake.state.text === 'A saved body', 'saved version shown');
    expect(section('Unsaved text')).toBeNull();
    await advance(5000);
    expect((await getNote(env2!, a)).body).toBe('A saved body');
    expect(await recover(env2!)).toEqual([]);
  });
});

describe('M1: Restore never overwrites newer typing', () => {
  async function setup() {
    env = makeEnv();
    const [a, other] = await seed(env, 'A saved body', 'B saved body');
    await journal(env, a!, 'A journal text');
    env2 = env.restart();
    b = await bootApp(env2, { ready: () => !!section('Recovered text') });
    return { a: a!, other: other! };
  }

  it('Restore on the note that is already open leaves the editor alone; the next note is untouched', async () => {
    const { a, other } = await setup();
    await click(rowFor(a));
    await waitFor(() => b!.fake.state.text === 'A journal text', 'A open');
    await act(async () => b!.fake.type('newer typing'));
    await click(byText(section('Recovered text')!, 'Restore'));
    await settle(10);
    expect(b!.fake.state.text).toBe('newer typing'); // the old journal text never replaces it
    await click(rowFor(other));
    await waitFor(() => b!.fake.state.text === 'B saved body', 'B open');
    await advance(5000);
    expect((await getNote(env2!, other)).body).toBe('B saved body');
    expect((await getNote(env2!, a)).body).toBe('newer typing'); // landed by the switch flush
  });

  it('Restore opens the note with its journal text and saves nothing until an edit', async () => {
    const { a } = await setup();
    await click(byText(section('Recovered text')!, 'Restore'));
    await waitFor(() => b!.fake.state.text === 'A journal text', 'A open with journal text');
    expect(opened(a)()).toBe(true);
    await advance(5000);
    expect(env2!.bridge.calls.filter((c) => c.method === 'notes.save')).toEqual([]);
  });

  it('choosing another note before the restored note loaded leaves that note unchanged', async () => {
    const { a, other } = await setup();
    const hold = env2!.bridge.hold('notes.get');
    await click(byText(section('Recovered text')!, 'Restore')); // opens A; notes.get waits
    await click(rowFor(other));
    await waitFor(() => hold.waiting >= 2, 'both loads waiting');
    hold.release();
    await waitFor(() => b!.fake.state.text === 'B saved body', 'B open');
    await advance(5000);
    expect((await getNote(env2!, other)).body).toBe('B saved body');
    expect(env2!.bridge.calls.filter((c) => c.method === 'notes.save')).toEqual([]);
    expect((await getNote(env2!, a)).body).toBe('A saved body');
  });

  it('Restore as new note puts the copy in the original note folder', async () => {
    env = makeEnv();
    const f = (await env.bridge.rpc('folders.create', { name: 'Work' })) as {
      value: { id: string };
    };
    const c = (await env.bridge.rpc('notes.create', { body: 'v1', folderId: f.value.id })) as {
      value: { id: string };
    };
    const id = c.value.id;
    const n = await getNote(env, id);
    await env.bridge.rpc('notes.save', { id, body: 'v2', expectedContentHash: n.contentHash });
    await env.bridge.rpc('drafts.write', {
      noteId: id,
      text: 'typed against v1',
      base: { rev: n.rev, contentHash: n.contentHash },
    });
    env2 = env.restart();
    b = await bootApp(env2, { ready: () => !!section('Recovered text') });
    await click(byText(section('Recovered text')!, 'Restore as new note'));
    await waitFor(
      () => b!.model().store.get().openId !== id && !!b!.model().store.get().openId,
      'copy open',
    );
    const copy = await getNote(env2, b!.model().store.get().openId!);
    expect(copy).toMatchObject({ body: 'typed against v1', folderId: f.value.id });
  });
});

describe('M2: Discard on the open note', () => {
  it('shows the saved body, empties the journal and saves nothing over the note', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'A saved body');
    await journal(env, a!, 'A journal text');
    env2 = env.restart();
    b = await bootApp(env2, { ready: () => !!section('Recovered text') });
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'A journal text', 'journal text');
    await act(async () => b!.fake.type('A journal text, newer'));
    await click(byText(section('Recovered text')!, 'Discard'));
    await waitFor(() => b!.fake.state.text === 'A saved body', 'saved body shown');
    await advance(5000);
    expect(section('Recovered text')).toBeNull();
    expect(section('Unsaved text')).toBeNull();
    expect(await recover(env2)).toEqual([]);
    expect(env2.bridge.calls.filter((c) => c.method === 'notes.save')).toEqual([]);
    expect((await getNote(env2, a!)).body).toBe('A saved body');
  });
});

describe('M3: opening a note with journal text does not save it', () => {
  it('no save for 5 s, the banner stays, Use saved version is reachable; one edit saves the full text', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'A saved body');
    await journal(env, a!, 'A journal text');
    env2 = env.restart();
    b = await bootApp(env2, { ready: () => !!section('Recovered text') });
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'A journal text', 'journal text');
    await advance(5000);
    expect(env2.bridge.calls.filter((c) => c.method === 'notes.save')).toEqual([]);
    expect(section('Unsaved text')).not.toBeNull();
    expect(byText(document.body, 'Use saved version')).toBeDefined();
    await act(async () => b!.fake.type('A journal text!'));
    await advance(1000);
    await waitFor(() => status().includes('Saved'), 'saved');
    expect((await getNote(env2, a!)).body).toBe('A journal text!');
    expect(section('Unsaved text')).toBeNull();
  });

  it('switching away from an untouched journal note saves nothing and keeps the journal', async () => {
    env = makeEnv();
    const [a, other] = await seed(env, 'A saved body', 'B saved body');
    await journal(env, a!, 'A journal text');
    env2 = env.restart();
    b = await bootApp(env2, { ready: () => !!section('Recovered text') });
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'A journal text', 'journal text');
    await click(rowFor(other!));
    await waitFor(() => b!.fake.state.text === 'B saved body', 'B open');
    await advance(5000);
    expect(env2.bridge.calls.filter((c) => c.method === 'notes.save')).toEqual([]);
    expect((await recover(env2)).map((d) => d.body)).toEqual(['A journal text']);
  });
});

describe('M4: trashed notes keep and show their journal text', () => {
  it('failed save, then trashed: the journal survives; opened from Trash it is read-only with the banner; Restore keeps the text', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'A saved body');
    b = await bootApp(env);
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'A saved body', 'A');
    await act(async () => b!.fake.type('A precious text'));
    env.bridge.inject('notes.save', { ok: false, error: { code: 'io', message: 'no space' } });
    await act(async () => void (await b!.model().actions.deleteNote(a!, 'A')));
    await waitFor(() => b!.model().store.get().openId === null, 'closed');
    expect((await recover(env)).map((d) => d.body)).toEqual(['A precious text']);

    await act(async () => b!.model().openNote(a!));
    await waitFor(() => b!.fake.state.text === 'A precious text', 'journal text read-only');
    expect(b!.fake.state.readOnly).toBe(true);
    expect(section('Unsaved text')).not.toBeNull();

    const saves = () => env!.bridge.calls.filter((c) => c.method === 'notes.save').length;
    const savesBefore = saves();
    await click(byText(document.body, 'Restore note'));
    await waitFor(() => !b!.fake.state.readOnly, 'editable again');
    await settle(20);
    expect(b!.fake.state.text).toBe('A precious text'); // not the saved body
    expect(section('Unsaved text')).not.toBeNull();
    await advance(5000);
    // Closing the trashed note made one more (core-rejected) save attempt; Restore itself saves nothing.
    expect(saves()).toBe(savesBefore);
    await act(async () => b!.fake.type('A precious text!'));
    await advance(1000);
    await waitFor(() => status().includes('Saved'), 'saved');
    expect((await getNote(env, a!)).body).toBe('A precious text!');
  });
});

describe('round 2 minors', () => {
  for (const method of ['drafts.flush', 'drafts.recover'] as const) {
    it(`1: a failed ${method} on open shows an error with Retry, never the saved body`, async () => {
      env = makeEnv();
      const [a] = await seed(env, 'A saved body');
      b = await bootApp(env);
      env.bridge.inject(method, { ok: false, error: { code: 'io', message: 'disk gone' } });
      await click(rowFor(a!));
      await waitFor(() => !!document.querySelector('[role=alert]'), 'error');
      expect(text()).toContain('disk gone');
      expect(b!.fake.state.text).not.toBe('A saved body');
      await click(byText(document.body, 'Retry'));
      await waitFor(() => b!.fake.state.text === 'A saved body', 'opened after Retry');
    });
  }

  it('2: the editor asks recover for the one note; the startup call stays argument-free', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'A');
    b = await bootApp(env);
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'A', 'A');
    const calls = env.bridge.calls.filter((c) => c.method === 'drafts.recover').map((c) => c.args);
    expect(calls[0]).toEqual({});
    expect(calls.at(-1)).toEqual({ noteId: a });
  });

  it('4: a draftError for a note that is not open flags that note and toasts; the status is untouched', async () => {
    env = makeEnv();
    const [a, other] = await seed(env, 'A', 'B');
    b = await bootApp(env);
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'A', 'A');
    await act(async () =>
      env!.bridge.emit({ type: 'draftError', noteId: other!, message: 'journal broke' }),
    );
    expect(status()).not.toContain('journal broke');
    expect(status()).toContain('Saved');
    expect(section('Unsaved changes')?.textContent).toContain('B');
    expect(text()).toContain('journal broke'); // the toast
  });
});

describe('minors', () => {
  it('1: text typed while the switch flush waits is saved, not dropped', async () => {
    env = makeEnv();
    const [a, other] = await seed(env, 'A', 'B');
    b = await bootApp(env);
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'A', 'A');
    const hold = env.bridge.hold('drafts.write');
    await act(async () => b!.fake.type('A1')); // its journal write stays unanswered
    await click(rowFor(other!));
    await waitFor(() => hold.waiting > 0, 'flush waiting on the journal');
    await act(async () => b!.fake.type('A12')); // typed during the switch flush
    hold.release();
    await waitFor(() => b!.fake.state.text === 'B', 'B open');
    expect((await getNote(env, a!)).body).toBe('A12');
  });

  it('2: the note actions follow the note in the editor, not the one being opened', async () => {
    env = makeEnv();
    const [a, other] = await seed(env, 'Alpha', 'Beta');
    b = await bootApp(env);
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'Alpha', 'A');
    await act(async () => b!.fake.type('Alpha edited'));
    const hold = env.bridge.hold('notes.save');
    await click(rowFor(other!));
    await waitFor(opened(other!), 'switching');
    await click(byText(document.body, 'Move to…'));
    expect(
      document.querySelector('[role=alertdialog], dialog, [aria-modal]')?.textContent,
    ).toContain('Move "Alpha"');
    hold.release();
    await waitFor(() => b!.fake.state.text === 'Beta', 'B');
  });

  it('3: a draftError keeps the status an error through a save, until a journal write succeeds', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'x');
    b = await bootApp(env);
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'x', 'x');
    await act(async () => b!.fake.type('x1'));
    await act(async () =>
      env!.bridge.emit({ type: 'draftError', noteId: a!, message: 'journal broke' }),
    );
    expect(status()).toContain('journal broke');
    await advance(1000); // the save succeeds
    await settle(20);
    expect(status()).toContain('journal broke');
    expect(status()).not.toContain('Saved');
    await act(async () => b!.fake.type('x12'));
    await settle(20);
    await advance(1000);
    await waitFor(() => status().includes('Saved'), 'saved after a journal write worked');
    expect(status()).not.toContain('journal broke');
  });

  it('4: Keep my text as a new note copies into the original folder and keeps text typed since', async () => {
    env = makeEnv();
    const f = (await env.bridge.rpc('folders.create', { name: 'Work' })) as {
      value: { id: string };
    };
    const c = (await env.bridge.rpc('notes.create', { body: 'v1', folderId: f.value.id })) as {
      value: { id: string };
    };
    const id = c.value.id;
    b = await bootApp(env);
    await click(rowFor(id));
    await waitFor(() => b!.fake.state.text === 'v1', 'v1');
    const n = await getNote(env, id);
    await env.bridge.rpc('notes.save', {
      id,
      body: 'v2 elsewhere',
      expectedContentHash: n.contentHash,
    });
    await act(async () => b!.fake.type('mine'));
    await advance(1000);
    await waitFor(() => !!section('Note changed elsewhere'), 'conflict');
    const hold = env.bridge.hold('notes.create');
    await click(byText(section('Note changed elsewhere')!, 'Keep my text as a new note'));
    await waitFor(() => hold.waiting > 0, 'create in flight');
    await act(async () => b!.fake.type('mine, typed while copying'));
    hold.release();
    await waitFor(() => b!.model().store.get().openId !== id, 'new note open');
    const copyId = b!.model().store.get().openId!;
    expect((await getNote(env, copyId)).folderId).toBe(f.value.id);
    expect((await getNote(env, copyId)).body).toBe('mine');
    expect((await recover(env)).map((d) => d.body)).toEqual(['mine, typed while copying']);
  });

  it('7: mounts under StrictMode and loads the list', async () => {
    env = makeEnv();
    await seed(env, 'Strict note');
    const fake = fakeEditorFactory();
    const m = await mount(
      <StrictMode>
        <App bridge={env.bridge} timers={manualTimers()} createEditor={fake.factory} />
      </StrictMode>,
    );
    try {
      await waitFor(() => noteOptions().length === 1, 'list in StrictMode');
      expect(text()).toContain('Strict note');
    } finally {
      await m.unmount();
    }
  });

  it('10: Unsaved changes while the timer is pending, Saving only while a request is in flight', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'x');
    b = await bootApp(env);
    await click(rowFor(a!));
    await waitFor(() => b!.fake.state.text === 'x', 'x');
    await act(async () => b!.fake.type('x1'));
    expect(status()).toContain('Unsaved changes');
    expect(status()).not.toContain('Saving…');
    const hold = env.bridge.hold('notes.save');
    await advance(1000);
    expect(status()).toContain('Saving…');
    hold.release();
    await waitFor(() => status().includes('Saved'), 'saved');
  });
});

describe('M-b: typing does not copy the document', () => {
  it('the pane gives the editor onDirty, not onChange', async () => {
    env = makeEnv();
    const opts: { onChange?: unknown; onDirty?: unknown }[] = [];
    const fake = fakeEditorFactory();
    const factory: EditorFactory = (p, o) => (opts.push(o), fake.factory(p, o));
    b = await bootApp(env, { editor: factory, ready: () => opts.length > 0 });
    expect(opts[0]!.onChange).toBeUndefined();
    expect(typeof opts[0]!.onDirty).toBe('function');
  });
});

describe('M-c: formatting toolbar', () => {
  function realEditor() {
    const h: { current?: EditorHandle } = {};
    const factory: EditorFactory = (p, o) => (h.current = createEditor(p, o));
    return { h, factory };
  }
  const toolbar = () =>
    document.querySelector<HTMLElement>('[role=toolbar][aria-label="Formatting"]');
  const btn = (label: string) =>
    toolbar()!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  async function openWith(body: string) {
    env = makeEnv();
    const [id] = await seed(env, body);
    const ed = realEditor();
    b = await bootApp(env, { editor: ed.factory });
    await click(rowFor(id!));
    await waitFor(() => ed.h.current?.getText() === body && !!toolbar(), 'note open');
    return { ed, id: id! };
  }

  it.each([
    ['Bold', 'hello', '**hello**'],
    ['Italic', 'hello', '*hello*'],
    ['Link', 'hello', '[hello](url)'],
    ['Bulleted list', 'hello', '- hello'],
    ['Cycle heading level', 'hello', '# hello'],
    ['Toggle checklist item', '- [ ] item', '- [x] item'],
  ])('%s produces the expected Markdown through the real editor', async (label, doc, want) => {
    const { ed } = await openWith(doc);
    const v = ed.h.current!.view;
    act(() => v.dispatch({ selection: { anchor: 0, head: doc.length } }));
    await click(btn(label));
    expect(ed.h.current!.getText()).toBe(want);
  });

  it('every button has an aria-label, the shortcut in its title, and is disabled in a trashed note', async () => {
    const { ed, id } = await openWith('hello');
    for (const [label, key] of [
      ['Bold', /Ctrl\+B|⌘B/],
      ['Italic', /Ctrl\+I|⌘I/],
    ] as const)
      expect(btn(label).title).toMatch(key);
    expect(toolbar()!.querySelectorAll('button')).toHaveLength(6);
    await act(async () => void (await env!.bridge.rpc('notes.trash', { id })));
    await act(async () => b!.model().openNote(null));
    // open the trashed note directly
    await act(async () => b!.model().openNote(id));
    await waitFor(() => ed.h.current?.view.state.readOnly === true && !!toolbar(), 'read-only');
    await waitFor(
      () => [...toolbar()!.querySelectorAll('button')].every((x) => x.disabled),
      'disabled',
    );
    await click(btn('Bold'));
    expect(ed.h.current!.getText()).toBe('hello');
  });

  it('is one tab stop; arrows, Home and End move between buttons; hidden in focus mode', async () => {
    await openWith('hello');
    const buttons = () => [...toolbar()!.querySelectorAll('button')];
    expect(buttons().filter((x) => x.tabIndex === 0)).toHaveLength(1);
    expect(buttons()[0]!.tabIndex).toBe(0);
    await act(async () => buttons()[0]!.focus());
    await press(buttons()[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(buttons()[1]);
    expect(buttons().filter((x) => x.tabIndex === 0)).toEqual([buttons()[1]]);
    await press(buttons()[1]!, 'End');
    expect(document.activeElement).toBe(buttons()[5]);
    await press(buttons()[5]!, 'ArrowRight'); // wraps
    expect(document.activeElement).toBe(buttons()[0]);
    await press(buttons()[0]!, 'ArrowLeft');
    expect(document.activeElement).toBe(buttons()[5]);
    await press(buttons()[5]!, 'Home');
    expect(document.activeElement).toBe(buttons()[0]);
    act(() => b!.model().toggleFocusMode());
    expect(toolbar()!.hidden).toBe(true);
  });

  it('the roving tab stop follows a mouse click and focus returns to the editor', async () => {
    const { ed } = await openWith('hello');
    const buttons = () => [...toolbar()!.querySelectorAll('button')];
    await click(buttons()[3]!);
    expect(buttons().filter((x) => x.tabIndex === 0)).toEqual([buttons()[3]]);
    expect(ed.h.current!.view.dom.contains(document.activeElement)).toBe(true);
    await act(async () => buttons()[4]!.focus());
    expect(buttons().filter((x) => x.tabIndex === 0)).toEqual([buttons()[4]]);
  });

  it('has no serious accessibility violations', async () => {
    document.documentElement.lang = 'en'; // jsdom has no <html lang>/<title>; the real page does (a11y.test.tsx)
    document.title = 'Mossnote';
    await openWith('hello');
    expect(serious(await runAxe())).toEqual([]);
  });
});

void sleep;
void press;
