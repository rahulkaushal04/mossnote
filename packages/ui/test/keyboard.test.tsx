// @vitest-environment jsdom
// AS-8 keyboard. jsdom never moves focus for a Tab key, so tab ORDER is computed from the DOM
// (document order + tabindex) and real Tab movement stays e2e (tests/e2e/a11y.e2e.ts). Every other
// key here is a real keydown through React's handlers, and focus checks use document.activeElement.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TAB_ESCAPE_HINT } from '../src/editor/extensions';
import { NAV } from '../src/layout/sizes';
import { bootApp, noteOptions, seed, text, treeItem, typeInto, type Booted } from './helpers/app';
import { byText, click, press, settle, waitFor } from './helpers/dom';
import { makeEnv, type Env } from './helpers/workspace';

let env: Env | undefined;
let b: Booted | undefined;
afterEach(async () => {
  await b?.m.unmount();
  env?.cleanup();
  b = env = undefined;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

const active = () => document.activeElement as HTMLElement | null;
const focus = (el: Element | null | undefined) => act(async () => void (el as HTMLElement).focus());
const palette = () => document.querySelector<HTMLInputElement>('input[role=combobox]');
const dialog = () => document.querySelector('[role=alertdialog]');
const cm = () => document.querySelector<HTMLElement>('.cm-content');
const trashRows = () => [...document.querySelectorAll<HTMLElement>('[data-batch]')];
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => press(el, k, init);
const openPalette = async () => {
  await key(document.body, 'k', { ctrlKey: true });
  await waitFor(() => !!palette(), 'palette');
};
const rows = async (e: Env, m: string, args: object = {}) => {
  const r = await e.bridge.rpc(m, args);
  if (!r.ok) throw new Error(r.error.message);
  return r.value as { id: string };
};

describe('tab order and tab stops', () => {
  it('goes nav, sidebar splitter, notes, list splitter, editor, status (from DOM order)', async () => {
    env = makeEnv();
    await seed(env, 'Alpha', 'Beta');
    await rows(env, 'folders.create', { name: 'Work' });
    b = await bootApp(env, { ready: () => noteOptions().length === 2 && !!treeItem('Work') });
    await click(noteOptions()[0]);
    await waitFor(() => !!document.querySelector('.toolbar'), 'toolbar');
    const tabbable = [
      ...document.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex], [contenteditable=true]',
      ),
    ].filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[hidden]'));
    const region = (el: HTMLElement) =>
      el.matches('[role=separator]')
        ? `splitter:${el.getAttribute('aria-label')}`
        : el.closest('nav')
          ? 'nav'
          : el.closest('#pane-list')
            ? 'notes'
            : el.closest('main')
              ? 'editor'
              : el.closest('footer')
                ? 'status'
                : el.closest('.toasts')
                  ? 'toasts'
                  : 'other';
    const order = tabbable.map(region).filter((r, i, a) => r !== a[i - 1]);
    expect(order).toEqual([
      'nav',
      'splitter:Resize sidebar',
      'notes',
      'splitter:Resize note list',
      'editor',
      // The status bar has no control while the note is saved (Retry appears only on an error).
    ]);
    // No positive tabindex anywhere (it would override the document order).
    expect(
      [...document.querySelectorAll('[tabindex]')].some(
        (e) => Number(e.getAttribute('tabindex')) > 0,
      ),
    ).toBe(false);
    // Roving tabindex: the tree and the list are each exactly one tab stop.
    expect(
      tabbable.filter((e) => e.closest('[role=tree]') && e.matches('[role=treeitem]')),
    ).toHaveLength(1);
    expect(tabbable.filter((e) => e.matches('[role=option]'))).toHaveLength(1);
    // The note actions are a named group of ordinary tab stops (no toolbar role to rove).
    const group = document.querySelector('[role=group][aria-label="Note actions"]')!;
    expect([...group.querySelectorAll('button')].every((x) => x.tabIndex === 0)).toBe(true);
  });
});

describe('every feature without a mouse', () => {
  it('list: arrows and Home/End move focus, Enter opens and focuses the editor, Delete trashes and moves on', async () => {
    env = makeEnv();
    await seed(env, 'One', 'Two', 'Three');
    b = await bootApp(env, { editor: 'real', ready: () => noteOptions().length === 3 });
    const [o1, o2, o3] = noteOptions() as [HTMLElement, HTMLElement, HTMLElement];
    await focus(o1);
    await key(o1, 'ArrowDown');
    expect(active()).toBe(o2);
    await key(o2, 'End');
    expect(active()).toBe(o3);
    await key(o3, 'ArrowUp');
    expect(active()).toBe(o2);
    await key(o2, 'Home');
    expect(active()).toBe(o1);
    await key(o1, 'Enter');
    await waitFor(() => b!.model().store.get().openId === o1.dataset.id, 'opened');
    expect(cm()!.contains(active()) || active() === cm()).toBe(true);
    // Delete from the list: trashed, toast, focus on the neighbour (never <body>).
    const list = noteOptions();
    await focus(list[1]);
    const gone = list[1]!.dataset.id!;
    await key(list[1]!, 'Delete');
    await waitFor(() => !!byText(document.body, 'Undo delete'), 'toast');
    expect(env.bridge.count('notes.trash')).toBe(1);
    await waitFor(() => !noteOptions().some((o) => o.dataset.id === gone), 'row gone');
    expect(active()?.getAttribute('role')).toBe('option');
  });

  it('tree: arrows expand and collapse, F2 renames (Enter saves), Delete trashes with an Undo toast', async () => {
    env = makeEnv();
    const parent = await rows(env, 'folders.create', { name: 'Parent' });
    await rows(env, 'folders.create', { name: 'Child', parentId: parent.id });
    await rows(env, 'folders.create', { name: 'Other' });
    b = await bootApp(env, { ready: () => !!treeItem('Parent') });
    const p = treeItem('Parent')!;
    await focus(p);
    expect(treeItem('Child')).toBeUndefined();
    await key(p, 'ArrowRight'); // expand
    await waitFor(() => !!treeItem('Child'), 'child');
    await key(p, 'ArrowRight'); // into the child
    expect(active()).toBe(treeItem('Child'));
    await key(active()!, 'ArrowLeft'); // back to the parent
    expect(active()).toBe(treeItem('Parent'));
    await key(active()!, 'ArrowLeft'); // collapse
    await waitFor(() => !treeItem('Child'), 'collapsed');

    const other = treeItem('Other')!;
    await focus(other);
    await key(other, 'F2');
    const input = await waitFor(
      () => !!document.querySelector('input[aria-label^="Rename folder"]'),
      'rename',
    ).then(() => document.querySelector<HTMLInputElement>('input[aria-label^="Rename folder"]')!);
    expect(active()).toBe(input);
    input.value = 'Renamed';
    await key(input, 'Enter');
    await waitFor(() => !!treeItem('Renamed'), 'renamed');
    await waitFor(() => active() === treeItem('Renamed'), 'focus back on the row');

    await key(treeItem('Renamed')!, 'Delete');
    await waitFor(() => !!byText(document.body, 'Undo delete'), 'undo toast');
    await waitFor(() => !treeItem('Renamed'), 'row gone');
    expect(active()?.getAttribute('role')).toBe('treeitem');
  });

  it('tree: the context menu opens from the keyboard, arrows move, Esc closes and focus returns to the row', async () => {
    env = makeEnv();
    await rows(env, 'folders.create', { name: 'Work' });
    b = await bootApp(env, { ready: () => !!treeItem('Work') });
    const row = treeItem('Work')!;
    await focus(row);
    await key(row, 'F10', { shiftKey: true });
    await waitFor(() => !!document.querySelector('[role=menu]'), 'menu');
    const items = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')];
    expect(items.map((i) => i.textContent)).toEqual([
      'New subfolder',
      'Rename',
      'Move to…',
      'Move to Trash',
    ]);
    expect(active()).toBe(items[0]);
    await key(items[0]!, 'ArrowDown');
    expect(active()).toBe(items[1]);
    await key(items[1]!, 'Escape');
    expect(document.querySelector('[role=menu]')).toBeNull();
    await waitFor(() => active() === treeItem('Work'), 'focus back');
  });

  it('trash view: arrows, Enter restores, Delete opens the confirm dialog (Cancel first), Esc returns focus', async () => {
    env = makeEnv();
    const [a, c] = await seed(env, 'Alpha', 'Charlie');
    await rows(env, 'notes.trash', { id: a });
    await rows(env, 'notes.trash', { id: c });
    b = await bootApp(env, { ready: () => !!treeItem('Trash') });
    await focus(treeItem('Trash'));
    await key(treeItem('Trash')!, 'Enter');
    await waitFor(() => trashRows().length === 2, 'trash rows');
    const [r1, r2] = trashRows() as [HTMLElement, HTMLElement];
    await focus(r1);
    await key(r1, 'ArrowDown');
    expect(active()).toBe(r2);
    await key(r2, 'Delete');
    await waitFor(() => !!dialog(), 'dialog');
    const cancel = byText(dialog() as HTMLElement, 'Cancel')!;
    const ok = byText(dialog() as HTMLElement, 'Delete permanently')!;
    expect(active()).toBe(cancel);
    expect(dialog()!.getAttribute('aria-labelledby')).toBeTruthy();
    // Tab is trapped: it wraps between the two buttons.
    await key(cancel, 'Tab');
    expect(active()).toBe(ok);
    await key(ok, 'Tab');
    expect(active()).toBe(cancel);
    await key(cancel, 'Tab', { shiftKey: true });
    expect(active()).toBe(ok);
    await key(ok, 'Escape');
    expect(dialog()).toBeNull();
    expect(active()).toBe(r2);
    expect(env.bridge.count('trash.purge')).toBe(0);
    await key(r2, 'Enter');
    await waitFor(() => trashRows().length === 1, 'restored');
    expect(env.bridge.count('trash.restore')).toBe(1);
  });

  it('tags: buttons are plain tab stops; Add tag, select, rename (Esc cancels, Enter saves)', async () => {
    env = makeEnv();
    await rows(env, 'tags.create', { name: 'ideas' });
    b = await bootApp(env, { ready: () => /ideas/.test(text()) });
    const tags = document.querySelector('ul[aria-label="Tags"]')!;
    expect([...tags.querySelectorAll('button')].every((x) => x.tabIndex === 0)).toBe(true);
    await typeInto(document.querySelector<HTMLInputElement>('label input')!, 'todo');
    await click(byText(document.body, 'Add tag'));
    await waitFor(() => /todo/.test(text()), 'new tag');
    await click(byText(tags as HTMLElement, 'ideas'));
    expect(b.model().nav.get()).toMatchObject({ kind: 'tag' });
    await click(document.querySelector('button[aria-label="Rename tag ideas"]'));
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Rename tag ideas"]')!;
    expect(active()).toBe(input);
    await key(input, 'Escape');
    expect(document.querySelector('input[aria-label="Rename tag ideas"]')).toBeNull();
    expect(env.bridge.count('tags.rename')).toBe(0);
    await click(document.querySelector('button[aria-label="Rename tag ideas"]'));
    const again = document.querySelector<HTMLInputElement>('input[aria-label="Rename tag ideas"]')!;
    again.value = 'thoughts';
    await key(again, 'Enter');
    await waitFor(() => /thoughts/.test(text()) && !/ideas/.test(text()), 'renamed');
  });

  it('palette: Mod-K opens, arrows move the active option, Enter runs it, Esc closes', async () => {
    env = makeEnv();
    await seed(env, 'Alpha');
    b = await bootApp(env);
    await openPalette();
    expect(active()).toBe(palette());
    const first = palette()!.getAttribute('aria-activedescendant');
    await key(palette()!, 'ArrowDown');
    expect(palette()!.getAttribute('aria-activedescendant')).not.toBe(first);
    await key(palette()!, 'Escape');
    expect(palette()).toBeNull();
    await openPalette();
    await typeInto(palette()!, 'Go to Trash');
    await key(palette()!, 'Enter');
    await waitFor(() => b!.model().nav.get().kind === 'trash', 'went to trash');
    expect(palette()).toBeNull();
  });

  it('shortcuts view: F1 opens with focus inside, F1 or Esc closes and focus returns', async () => {
    env = makeEnv();
    await seed(env, 'Alpha');
    b = await bootApp(env);
    const opener = noteOptions()[0]!;
    await focus(opener);
    await key(opener, 'F1');
    await waitFor(() => /Keyboard shortcuts/.test(text()), 'view');
    const dlg = document.querySelector<HTMLElement>('[aria-labelledby=mn-shortcuts-title]')!;
    expect(dlg.contains(active())).toBe(true);
    await key(dlg, 'F1');
    expect(document.querySelector('#mn-shortcuts-title')).toBeNull();
    expect(active()).toBe(opener);
    await key(opener, 'F1');
    await waitFor(() => /Keyboard shortcuts/.test(text()), 'view again');
    await key(document.querySelector('[aria-labelledby=mn-shortcuts-title]')!, 'Escape');
    expect(document.querySelector('#mn-shortcuts-title')).toBeNull();
    expect(active()).toBe(opener);
  });

  it('splitters: arrows step 16, Shift 64, Home/End jump, Enter collapses the sidebar, and sizes persist', async () => {
    env = makeEnv();
    b = await bootApp(env);
    const sep = document.querySelector<HTMLElement>(
      '[role=separator][aria-label="Resize sidebar"]',
    )!;
    const val = () => Number(sep.getAttribute('aria-valuenow'));
    const start = val();
    await focus(sep);
    await key(sep, 'ArrowRight');
    expect(val()).toBe(start + 16);
    await key(sep, 'ArrowRight', { shiftKey: true });
    expect(val()).toBe(start + 16 + 64);
    await key(sep, 'ArrowLeft');
    expect(val()).toBe(start + 64);
    await key(sep, 'Home');
    expect(val()).toBe(NAV.min);
    await key(sep, 'End');
    expect(val()).toBe(Number(sep.getAttribute('aria-valuemax')));
    await key(sep, 'Enter');
    expect(document.querySelector('nav')!.hasAttribute('hidden')).toBe(true);
    await key(sep, 'Enter');
    expect(document.querySelector('nav')!.hasAttribute('hidden')).toBe(false);
    await act(async () => void (await b!.timers.advance(400)));
    const prefs = await env.bridge.rpc('prefs.get');
    expect(prefs).toMatchObject({ ok: true, value: { navWidth: val(), navCollapsed: false } });
  });
});

describe('palette bug: choosing "Command palette" from inside the palette', () => {
  it('closes it and it stays closed', async () => {
    env = makeEnv();
    b = await bootApp(env);
    await openPalette();
    await typeInto(palette()!, 'Command palette');
    await key(palette()!, 'Enter');
    await settle(20);
    expect(palette()).toBeNull();
    // ...and it still opens afterwards.
    await openPalette();
    expect(palette()).not.toBeNull();
  });
});

describe('focus returns where the user was', () => {
  it('palette: Esc, Mod-K again and picking a command all return focus to the opener', async () => {
    env = makeEnv();
    await seed(env, 'Alpha');
    b = await bootApp(env);
    const opener = noteOptions()[0]!;
    await focus(opener);
    await openPalette();
    await key(palette()!, 'Escape');
    expect(active()).toBe(opener);
    await openPalette();
    await key(palette()!, 'k', { ctrlKey: true });
    expect(palette()).toBeNull();
    expect(active()).toBe(opener);
    await openPalette();
    await typeInto(palette()!, 'Theme: dark');
    await key(palette()!, 'Enter');
    await waitFor(() => document.documentElement.dataset.theme === 'dark', 'dark');
    expect(active()).toBe(opener);
  });

  it('palette opened from inside the real editor returns focus to the editor', async () => {
    env = makeEnv();
    await seed(env, 'Alpha\nbody');
    b = await bootApp(env, { editor: 'real' });
    await click(noteOptions()[0]);
    await waitFor(() => !!document.querySelector('.cm-line'), 'editor');
    await focus(cm());
    expect(active()).toBe(cm());
    await key(cm()!, 'k', { ctrlKey: true });
    await waitFor(() => !!palette(), 'palette');
    await key(palette()!, 'Escape');
    expect(active()).toBe(cm());
  });

  it('confirm dialog: Cancel returns focus to the row that opened it', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'Alpha');
    await rows(env, 'notes.trash', { id: a });
    b = await bootApp(env, { ready: () => !!treeItem('Trash') });
    await click(treeItem('Trash'));
    await waitFor(() => trashRows().length === 1, 'row');
    const row = trashRows()[0]!;
    await focus(row);
    await key(row, 'Delete');
    await waitFor(() => !!dialog(), 'dialog');
    await click(byText(dialog() as HTMLElement, 'Cancel'));
    expect(dialog()).toBeNull();
    expect(active()).toBe(row);
  });

  it('Undo toast: using it returns focus to where the user came from, or to the list', async () => {
    env = makeEnv();
    await seed(env, 'One', 'Two', 'Three');
    b = await bootApp(env, { ready: () => noteOptions().length === 3 });
    const model = b.model();
    // Keyboard user deletes from the list, then Tabs to the toast and presses Undo.
    const [o1, o2] = noteOptions() as [HTMLElement, HTMLElement];
    await focus(o1);
    await act(async () => void (await model.actions.deleteNote(o2.dataset.id!, 'Two')));
    await waitFor(() => !!byText(document.body, 'Undo delete'), 'toast');
    expect(active()).toBe(o1);
    await focus(byText(document.body, 'Undo delete'));
    await click(byText(document.body, 'Undo delete'));
    await waitFor(() => noteOptions().length === 3, 'restored');
    expect(active()).toBe(o1);

    // The old focus target is gone: focus lands on the list, never on <body>.
    await act(async () => void (await model.actions.deleteNote(o1.dataset.id!, 'One')));
    await waitFor(() => !!byText(document.body, 'Undo delete'), 'toast 2');
    await act(async () => void active()?.blur());
    await focus(byText(document.body, 'Undo delete'));
    await click(byText(document.body, 'Undo delete'));
    await waitFor(() => noteOptions().length === 3, 'restored 2');
    expect(active()).not.toBe(document.body);
    expect(active()?.closest('[role=listbox]')).not.toBeNull();

    // Dismiss behaves the same way.
    await act(async () => void (await model.actions.deleteNote(o2.dataset.id!, 'Two')));
    await waitFor(() => !!byText(document.body, 'Undo delete'), 'toast 3');
    await focus(noteOptions()[0]);
    const before = active();
    await focus(document.querySelector('button[aria-label="Dismiss notification"]'));
    await click(document.querySelector('button[aria-label="Dismiss notification"]'));
    expect(active()).toBe(before);
  });
});

describe('Esc priority: dialog > palette > focus mode > editor', () => {
  const focusMode = () => b!.model().store.get().focusMode;

  it('palette first, then focus mode', async () => {
    env = makeEnv();
    await seed(env, 'Alpha\nbody');
    b = await bootApp(env, { editor: 'real' });
    await click(noteOptions()[0]);
    await waitFor(() => !!document.querySelector('.cm-line'), 'editor');
    await key(document.body, 'f', { ctrlKey: true, shiftKey: true });
    expect(focusMode()).toBe(true);
    await openPalette();
    await key(palette()!, 'Escape');
    expect(palette()).toBeNull();
    expect(focusMode()).toBe(true);
    await key(cm()!, 'Escape');
    expect(focusMode()).toBe(false);
  });

  it('a dialog first, then focus mode (menu command while the dialog is open)', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'Alpha');
    await rows(env, 'notes.trash', { id: a });
    b = await bootApp(env, { ready: () => !!treeItem('Trash') });
    await click(treeItem('Trash'));
    await waitFor(() => trashRows().length === 1, 'row');
    await click(byText(document.body, 'Delete permanently…'));
    await waitFor(() => !!dialog(), 'dialog');
    env.bridge.emit({ type: 'command', id: 'view.focusMode' });
    await waitFor(() => focusMode(), 'focus mode on');
    await key(byText(dialog() as HTMLElement, 'Cancel')!, 'Escape');
    expect(dialog()).toBeNull();
    expect(focusMode()).toBe(true);
    await key(document.body, 'Escape');
    expect(focusMode()).toBe(false);
  });

  it('focus mode before the editor: Esc leaves focus mode and CodeMirror never sees it', async () => {
    env = makeEnv();
    await seed(env, 'Alpha\nbody');
    b = await bootApp(env, { editor: 'real' });
    await click(noteOptions()[0]);
    await waitFor(() => !!document.querySelector('.cm-line'), 'editor');
    await key(document.body, 'f', { ctrlKey: true, shiftKey: true });
    const seen: string[] = [];
    cm()!.addEventListener('keydown', (e) => seen.push((e as KeyboardEvent).key));
    await key(cm()!, 'Escape', { keyCode: 27 });
    expect(focusMode()).toBe(false);
    expect(seen).toEqual([]);
    // With focus mode off, Esc belongs to the editor again.
    await key(cm()!, 'Escape', { keyCode: 27 });
    expect(seen).toEqual(['Escape']);
  });
});

describe('editor Tab escape (keymap level; real focus movement is e2e)', () => {
  const tab = (el: Element) => {
    const ev = new KeyboardEvent('keydown', {
      key: 'Tab',
      keyCode: 9,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev;
  };

  it('Tab indents (is consumed) until Esc is pressed; after Esc, Tab is left to the browser', async () => {
    env = makeEnv();
    await seed(env, 'Alpha\nbody');
    b = await bootApp(env, { editor: 'real' });
    await click(noteOptions()[0]);
    await waitFor(() => !!document.querySelector('.cm-line'), 'editor');
    const el = cm()!;
    await focus(el);
    expect(tab(el).defaultPrevented).toBe(true);
    await key(el, 'Escape', { keyCode: 27 });
    expect(tab(el).defaultPrevented).toBe(false);
    // Any other key ends the escape window again.
    await key(el, 'a', { keyCode: 65 });
    expect(tab(el).defaultPrevented).toBe(true);
  });

  it('Ctrl-m toggles Tab focus mode and the editor announces how to leave it', async () => {
    env = makeEnv();
    await seed(env, 'Alpha\nbody');
    b = await bootApp(env, { editor: 'real' });
    await click(noteOptions()[0]);
    await waitFor(() => !!document.querySelector('.cm-line'), 'editor');
    const el = cm()!;
    await focus(el);
    await key(el, 'm', { ctrlKey: true, keyCode: 77 });
    expect(tab(el).defaultPrevented).toBe(false);
    await key(el, 'm', { ctrlKey: true, keyCode: 77 });
    expect(tab(el).defaultPrevented).toBe(true);
    const hint = document.getElementById(el.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toBe(TAB_ESCAPE_HINT);
    expect(TAB_ESCAPE_HINT).toMatch(/Escape then Tab/);
    expect(el.getAttribute('aria-label')).toBe('Note editor');
  });
});

describe('focus is always visible; motion respects the user (CSS rules)', () => {
  const SRC = join(__dirname, '../src');
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const css = walk(SRC).filter((f) => f.endsWith('.css'));

  it('base.css has a :focus-visible outline and the reduced-motion rule', () => {
    const base = readFileSync(join(SRC, 'theme/base.css'), 'utf8');
    expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
    expect(base).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none !important/,
    );
    expect(base).toMatch(/animation: none !important/);
  });
  it('no stylesheet removes the focus outline', () => {
    const offenders = css.filter((f) => /outline\s*:\s*(none|0)\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('focusable pieces the shell styles are not hidden from keyboard users', () => {
    // A guard against `display: none` on a splitter or the nav toggle being "the fix" for layout.
    const shell = readFileSync(join(SRC, 'layout/shell.css'), 'utf8');
    expect(shell).not.toMatch(/\.splitter\s*\{[^}]*display:\s*none/);
  });
});
