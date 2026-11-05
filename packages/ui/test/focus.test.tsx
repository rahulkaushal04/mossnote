// @vitest-environment jsdom
import { act } from 'react';
import { undoDepth } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { click, mount, press, waitFor, type Mounted } from './helpers/dom';
import { manualTimers } from './helpers/timers';
import { makeEnv, type Env } from './helpers/workspace';

let env: Env | undefined;
let m: Mounted | undefined;
afterEach(async () => {
  await m?.unmount();
  env?.cleanup();
  m = env = undefined;
});

const cmEl = () => document.querySelector<HTMLElement>('.cm-editor')!;
const view = () => EditorView.findFromDOM(cmEl())!;
const hidden = (sel: string) => document.querySelector(sel)!.hasAttribute('hidden');
const panes = () => ({
  nav: hidden('nav'),
  list: hidden('#pane-list'),
  footer: hidden('footer'),
  toolbar: hidden('.toolbar'),
});
const toggle = () => press(document.body, 'f', { ctrlKey: true, shiftKey: true });

async function openNote() {
  env = makeEnv();
  await env.bridge.rpc('notes.create', { body: 'first line\nsecond line' });
  m = await mount(<App bridge={env.bridge} timers={manualTimers()} />);
  await waitFor(
    () => document.querySelectorAll('ul[aria-label="Notes"] [role=option]').length > 0,
    'list',
  );
  await click(document.querySelector('ul[aria-label="Notes"] [role=option]'));
  await waitFor(
    () => !!document.querySelector('.cm-editor') && view().state.doc.length > 0,
    'editor',
  );
}

describe('focus mode', () => {
  it('keeps the same EditorView, selection, undo depth, text and DOM node across the toggle', async () => {
    await openNote();
    const v = view();
    const node = cmEl();
    await act(async () => {
      v.dispatch({ changes: { from: 0, insert: 'typed ' }, userEvent: 'input.type' });
      v.dispatch({ selection: EditorSelection.single(3, 8) });
    });
    const depth = undoDepth(v.state);
    expect(depth).toBeGreaterThan(0);
    const text = v.state.doc.toString();
    expect(panes()).toEqual({ nav: false, list: false, footer: false, toolbar: false });

    await toggle();
    expect(panes()).toEqual({ nav: true, list: true, footer: true, toolbar: true });
    expect(view()).toBe(v);
    expect(cmEl()).toBe(node);
    expect(v.state.doc.toString()).toBe(text);
    expect(v.state.selection.main.from).toBe(3);
    expect(v.state.selection.main.to).toBe(8);
    expect(undoDepth(v.state)).toBe(depth);

    await toggle(); // the same key leaves it
    expect(panes()).toEqual({ nav: false, list: false, footer: false, toolbar: false });
    expect(view()).toBe(v);
    expect(undoDepth(v.state)).toBe(depth);
  });

  it('Esc exits focus mode, also when pressed inside the editor', async () => {
    await openNote();
    await toggle();
    expect(panes().nav).toBe(true);
    await press(view().contentDOM, 'Escape');
    expect(panes()).toEqual({ nav: false, list: false, footer: false, toolbar: false });
  });

  it('Esc priority: the palette closes first, then focus mode; Esc outside focus mode is not taken', async () => {
    await openNote();
    await toggle();
    await press(document.body, 'k', { ctrlKey: true });
    await waitFor(() => !!document.querySelector('input[role=combobox]'), 'palette');
    await press(document.querySelector('input[role=combobox]')!, 'Escape');
    expect(document.querySelector('input[role=combobox]')).toBeNull();
    expect(panes().nav).toBe(true); // still in focus mode
    await press(view().contentDOM, 'Escape');
    expect(panes().nav).toBe(false);
    // not in focus mode: Esc must reach the editor (defaultPrevented is CodeMirror's business)
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    let seenByEditor = false;
    view().contentDOM.addEventListener('keydown', () => (seenByEditor = true), { once: true });
    await act(async () => void view().contentDOM.dispatchEvent(ev));
    expect(seenByEditor).toBe(true);
  });

  it('the palette command also toggles it', async () => {
    await openNote();
    await act(async () => env!.bridge.emit({ type: 'command', id: 'view.focusMode' }));
    expect(panes().nav).toBe(true);
    await act(async () => env!.bridge.emit({ type: 'command', id: 'view.focusMode' }));
    expect(panes().nav).toBe(false);
  });
});
