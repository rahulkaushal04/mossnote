// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { createDispatcher } from '@mossnote/core';
import { App } from '../src/app/App';
import type { AppModel } from '../src/app/model';
import type { EditorFactory } from '../src/editor/EditorPane';
import {
  byText,
  click,
  fakeEditorFactory,
  mount,
  press,
  waitFor,
  type Mounted,
} from './helpers/dom';
import { createLoopback } from './helpers/loopback';
import { manualTimers } from './helpers/timers';
import { makeEnv, type Env } from './helpers/workspace';

let env: Env | undefined;
let m: Mounted | undefined;
afterEach(async () => {
  await m?.unmount();
  env?.cleanup();
  m = env = undefined;
  document.documentElement.removeAttribute('data-theme');
});

const options = () => [
  ...document.querySelectorAll<HTMLElement>('ul[aria-label="Notes"] [role=option]'),
];
const titles = () => options().map((o) => o.textContent);
const treeItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role=treeitem]')].find((e) =>
    e.textContent?.includes(label),
  );
const resultLabels = () =>
  [
    ...document.querySelectorAll(
      '[role=listbox][aria-label="Results"] [role=option] > span:first-child',
    ),
  ].map((e) => e.textContent);
const paletteInput = () => document.querySelector<HTMLInputElement>('input[role=combobox]');

async function boot(e: Env, o: { real?: boolean; factory?: EditorFactory } = {}) {
  const timers = manualTimers();
  const fake = fakeEditorFactory();
  let model: AppModel | undefined;
  m = await mount(
    <App
      bridge={e.bridge}
      timers={timers}
      {...(o.real ? {} : { createEditor: o.factory ?? fake.factory })}
      onReady={(x) => (model = x)}
    />,
  );
  await waitFor(
    () => options().length > 0 || /No notes yet/.test(document.body.textContent ?? ''),
    'list',
  );
  return {
    timers,
    fake,
    model: () => model!,
    advance: (ms: number) => act(async () => void (await timers.advance(ms))),
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
async function typeInto(el: HTMLInputElement, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const openPalette = async () => {
  await press(document.body, 'k', { ctrlKey: true });
  await waitFor(() => !!paletteInput(), 'palette');
};

describe('shell integration (real workspace over the loopback)', () => {
  it('Mod-K opens the palette; typing "New note" and Enter creates and opens a note', async () => {
    env = makeEnv();
    const b = await boot(env);
    await openPalette();
    await typeInto(paletteInput()!, 'New note');
    await press(paletteInput()!, 'Enter');
    await waitFor(() => options().length === 1, 'new row');
    expect(paletteInput()).toBeNull();
    expect(env.bridge.count('notes.create')).toBe(1);
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(b.fake.state.created).toBe(1);
    // Mod-K again toggles it shut
    await openPalette();
    await press(document.body, 'k', { ctrlKey: true });
    expect(paletteInput()).toBeNull();
  });

  it('the palette lists every note even when the nav shows a filtered list', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'Alpha', 'Beta');
    await env.bridge.rpc('notes.setFavorite', { id: a!, favorite: true });
    await boot(env);
    await click(treeItem('Favorites'));
    await waitFor(() => titles().length === 1, 'filtered');
    await openPalette();
    await waitFor(
      () =>
        document.body.textContent!.includes('Alpha') && document.body.textContent!.includes('Beta'),
      'both notes in palette',
    );
  });

  it('nav selection changes the list (favorites, then all, then a folder)', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'Alpha', 'Beta');
    await env.bridge.rpc('notes.setFavorite', { id: a!, favorite: true });
    const f = await env.bridge.rpc('folders.create', { name: 'Work' });
    const b = await boot(env);
    expect(titles().sort()).toEqual(['Alpha', 'Beta']);
    await click(treeItem('Favorites'));
    await waitFor(() => titles().join() === 'Alpha', 'favorites only');
    await click(treeItem('All notes'));
    await waitFor(() => titles().length === 2, 'all again');
    await click(treeItem('Work'));
    await waitFor(() => /No notes yet/.test(document.body.textContent ?? ''), 'empty folder');
    expect(b.model().nav.get()).toEqual({
      kind: 'folder',
      id: (f as { value: { id: string } }).value.id,
    });
    // a note created while a folder is selected lands in it
    await click(byText(document.body, 'New note'));
    await waitFor(() => options().length === 1, 'note in folder');
  });

  it('delete shows a toast; Undo within 10 s restores the note; after 10 s the toast is gone', async () => {
    env = makeEnv();
    const [id] = await seed(env, 'Doomed', 'Stays');
    const b = await boot(env);
    const row = options().find((o) => o.textContent === 'Doomed')!;
    await press(row, 'Delete');
    await waitFor(() => titles().join() === 'Stays', 'row removed');
    const undo = () => byText(document.body, 'Undo delete');
    await waitFor(() => !!undo(), 'undo toast');
    expect(document.body.textContent).toContain('Moved "Doomed" to Trash.');
    await b.advance(9000);
    await click(undo());
    await waitFor(() => titles().length === 2, 'note restored');
    const got = await env.bridge.rpc('notes.get', { id: id! });
    expect(got).toMatchObject({ ok: true, value: { trashed: false } });

    await press(
      options().find((o) => o.textContent === 'Stays')!,
      'Delete',
    );
    await waitFor(() => !!undo(), 'second toast');
    await b.advance(10_001);
    expect(undo()).toBeUndefined();
  });

  it('deleting the open note flushes its text first and closes the editor', async () => {
    env = makeEnv();
    const [id] = await seed(env, 'start');
    const b = await boot(env);
    await click(options()[0]);
    await waitFor(() => b.fake.state.text === 'start', 'loaded');
    await act(async () => b.fake.type('typed before delete'));
    await press(options()[0]!, 'Delete');
    await waitFor(() => !!byText(document.body, 'Undo delete'), 'toast');
    expect(b.model().store.get().openId).toBeNull();
    const got = await env.bridge.rpc('notes.get', { id: id! });
    expect(got).toMatchObject({ ok: true, value: { body: 'typed before delete', trashed: true } });
  });

  it('a trashed note opens read-only from Trash with the banner; Restore re-enables editing', async () => {
    env = makeEnv();
    const [id] = await seed(env, 'in the bin');
    await env.bridge.rpc('notes.trash', { id: id! });
    const b = await boot(env);
    await click(treeItem('Trash'));
    await waitFor(() => !!byText(document.body, 'Open'), 'trash row');
    await click(byText(document.body, 'Open'));
    await waitFor(() => b.fake.state.text === 'in the bin', 'opened');
    expect(b.fake.state.readOnly).toBe(true);
    expect(document.querySelector('[aria-label="Trashed note"]')).not.toBeNull();
    await click(byText(document.body, 'Restore note'));
    await waitFor(() => !b.fake.state.readOnly, 'editable');
    expect(document.querySelector('[aria-label="Trashed note"]')).toBeNull();
    const got = await env.bridge.rpc('notes.get', { id: id! });
    expect(got).toMatchObject({ ok: true, value: { trashed: false } });
  });

  it('a desktop `command` event runs the same handler as the key', async () => {
    env = makeEnv();
    const b = await boot(env);
    await act(async () => env!.bridge.emit({ type: 'command', id: 'nav.favorites' }));
    expect(b.model().nav.get().kind).toBe('favorites');
    await act(async () => env!.bridge.emit({ type: 'command', id: 'note.new' }));
    await waitFor(() => env!.bridge.count('notes.create') === 1, 'created via menu command');
    await act(async () => env!.bridge.emit({ type: 'command', id: 'view.shortcuts' }));
    expect(document.querySelector('[aria-labelledby="mn-shortcuts-title"]')).not.toBeNull();
    await act(async () => env!.bridge.emit({ type: 'command', id: 'does.not.exist' })); // ignored
  });

  it('capture.open from the palette asks main to open the capture window', async () => {
    env = makeEnv();
    await boot(env);
    await openPalette();
    await typeInto(paletteInput()!, 'Quick capture');
    await press(paletteInput()!, 'Enter');
    await waitFor(() => env!.bridge.count('app.openCapture') === 1, 'app.openCapture');
  });

  it('flushRequest still saves the open note before app.flushed is answered', async () => {
    env = makeEnv();
    const [id] = await seed(env, 'start');
    const b = await boot(env);
    await click(options()[0]);
    await waitFor(() => b.fake.state.text === 'start', 'loaded');
    await act(async () => b.fake.type('typed right before quit'));
    await act(async () => env!.bridge.emit({ type: 'flushRequest', token: 'tok' }));
    await waitFor(() => env!.bridge.count('app.flushed') === 1, 'app.flushed');
    const calls = env.bridge.calls.map((c) => c.method);
    expect(calls.indexOf('notes.save')).toBeGreaterThan(-1);
    expect(calls.indexOf('notes.save')).toBeLessThan(calls.indexOf('app.flushed'));
    const got = await env.bridge.rpc('notes.get', { id: id! });
    expect(got).toMatchObject({ ok: true, value: { body: 'typed right before quit' } });
  });

  it('the status event appears as a toast', async () => {
    env = makeEnv();
    await boot(env);
    await act(async () =>
      env!.bridge.emit({
        type: 'status',
        message: 'Quick capture shortcut is unavailable.',
        level: 'warn',
      }),
    );
    expect(document.querySelector('[aria-label="Notifications"]')!.textContent).toContain(
      'Quick capture shortcut is unavailable.',
    );
  });

  it('theme commands switch data-theme and persist the preference', async () => {
    env = makeEnv();
    await boot(env);
    await act(async () => env!.bridge.emit({ type: 'command', id: 'theme.dark' }));
    await waitFor(() => document.documentElement.dataset.theme === 'dark', 'dark');
    expect(await env.bridge.rpc('prefs.get')).toMatchObject({ ok: true, value: { theme: 'dark' } });
    await act(async () => env!.bridge.emit({ type: 'command', id: 'theme.light' }));
    await waitFor(() => document.documentElement.dataset.theme === 'light', 'light');
    expect(await env.bridge.rpc('prefs.get')).toMatchObject({
      ok: true,
      value: { theme: 'light' },
    });
  });

  it('the saved theme is applied before the shell first renders', async () => {
    env = makeEnv();
    await env.bridge.rpc('prefs.set', { theme: 'dark' });
    const seen: string[] = [];
    const fake = fakeEditorFactory();
    // The editor is created right after the shell's first render: the theme must already be set.
    const factory: EditorFactory = (parent, opts) => {
      seen.push(document.documentElement.dataset.theme ?? 'none');
      return fake.factory(parent, opts);
    };
    await boot(env, { factory });
    expect(seen).toEqual(['dark']);
  });

  it('the status bar shows "Sync: Not paired"', async () => {
    env = makeEnv();
    await boot(env);
    expect(document.querySelector('footer')!.textContent).toContain('Sync: Not paired');
  });

  it('the fatal screen Quit calls app.quit', async () => {
    let quits = 0; // main's onQuit: the call must get THROUGH the failed workspace, not just be sent
    const d = createDispatcher(
      { ok: false, error: { code: 'corrupt', message: 'db damaged' } },
      { onQuit: () => quits++ },
    );
    const bridge = createLoopback(d);
    m = await mount(<App bridge={bridge} />);
    await waitFor(() => /db damaged/.test(document.body.textContent ?? ''), 'fatal');
    await click(byText(document.body, 'Quit'));
    expect(bridge.count('app.quit')).toBe(1);
    expect(quits).toBe(1);
  });
});

describe('format commands respect the editor state', () => {
  const cmEl = () => document.querySelector<HTMLElement>('.cm-editor');
  const view = () => EditorView.findFromDOM(cmEl()!)!;
  const run = (id: string) => act(async () => env!.bridge.emit({ type: 'command', id }));

  it('do nothing with no note, run on an editable note, and do nothing in a trashed note', async () => {
    env = makeEnv();
    const [id] = await seed(env, 'plain');
    const b = await boot(env, { real: true });
    await run('format.bold');
    expect(view().state.doc.toString()).toBe('');
    await click(options()[0]);
    await waitFor(() => view().state.doc.toString() === 'plain', 'loaded');
    await run('format.bold');
    expect(view().state.doc.toString()).toBe('****plain');
    // trashed: reopen read-only; the same command must not edit
    await env.bridge.rpc('notes.trash', { id: id! });
    await act(async () => b.model().openNote(null));
    await act(async () => b.model().openNote(id!));
    await waitFor(() => view().state.readOnly, 'read-only');
    const before = view().state.doc.toString();
    await run('format.bold');
    expect(view().state.doc.toString()).toBe(before);
  });

  it('the palette hides format commands without an editable note', async () => {
    env = makeEnv();
    await seed(env, 'plain');
    await boot(env, { real: true });
    await openPalette();
    await typeInto(paletteInput()!, 'Bold');
    expect(resultLabels()).not.toContain('Bold');
    await press(paletteInput()!, 'Escape');
    await click(options()[0]);
    await waitFor(() => view().state.doc.toString() === 'plain', 'loaded');
    await openPalette();
    await typeInto(paletteInput()!, 'Bold');
    expect(document.querySelector('[role=listbox][aria-label="Results"]')!.textContent).toContain(
      'Bold',
    );
  });
});
