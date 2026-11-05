// @vitest-environment jsdom
// AS-8 / AS-16 (automated part). REAL timers for axe (it hangs under vitest fake timers); the app
// itself uses manual timers. jsdom has no layout: color-contrast is NOT judged here (contrast.test.ts
// covers the token pairs), focus rings and real tab movement are e2e (tests/e2e/a11y.e2e.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaptureApp } from '../src/capture/CaptureApp';
import { applyTheme } from '../src/theme/applyTheme';
import {
  bootApp,
  fail,
  noteOptions,
  runAxe,
  serious,
  seed,
  text,
  treeItem,
  type Booted,
} from './helpers/app';
import { byText, click, mount, press, waitFor, type Mounted } from './helpers/dom';
import { makeEnv, type Env } from './helpers/workspace';

// jsdom's document has no <html lang> or <title>; the real page does (asserted below), so mirror it.
const INDEX = readFileSync(join(__dirname, '../index.html'), 'utf8');
beforeEach(() => {
  document.documentElement.lang = /<html lang="([\w-]+)"/.exec(INDEX)?.[1] ?? '';
  document.title = /<title>([^<]+)<\/title>/.exec(INDEX)?.[1] ?? '';
});

let env: Env | undefined;
let b: Booted | undefined;
let extra: Mounted | undefined;
afterEach(async () => {
  await b?.m.unmount();
  await extra?.unmount();
  env?.cleanup();
  b = extra = env = undefined;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

const cmReady = () => !!document.querySelector('.cm-editor .cm-line');
async function openFirst() {
  await click(noteOptions()[0]);
  await waitFor(cmReady, 'editor');
}
const trashOne = async (e: Env, id: string) => void (await e.bridge.rpc('notes.trash', { id }));

type Theme = 'light' | 'dark';
interface Scenario {
  name: string;
  run(e: Env, theme: Theme): Promise<void>;
}
const scenarios: Scenario[] = [
  {
    name: 'main shell: notes list and an open note (real CodeMirror)',
    async run(e, theme) {
      await seed(e, 'Alpha\nbody text', 'Beta');
      b = await bootApp(e, { theme, editor: 'real' });
      await openFirst();
    },
  },
  {
    name: 'empty workspace',
    async run(e, theme) {
      b = await bootApp(e, { theme });
      expect(text()).toContain('No notes yet');
    },
  },
  {
    name: 'error states: list, folders, tags and trash fail to load',
    async run(e, theme) {
      for (const m of ['notes.list', 'folders.list', 'tags.list', 'trash.list'])
        e.bridge.inject(m, fail(`${m} down`), 50);
      b = await bootApp(e, { theme, ready: () => /Couldn’t load notes/.test(text()) });
      await waitFor(() => /Couldn’t load tags/.test(text()), 'tags error');
    },
  },
  {
    name: 'error state: the editor cannot open a note',
    async run(e, theme) {
      await seed(e, 'Alpha');
      b = await bootApp(e, { theme });
      e.bridge.inject('notes.get', fail('read failed'), 5);
      await click(noteOptions()[0]);
      await waitFor(() => /Couldn’t open note/.test(text()), 'editor error');
    },
  },
  {
    name: 'trash view',
    async run(e, theme) {
      const [id] = await seed(e, 'Gone note', 'Kept');
      await trashOne(e, id!);
      b = await bootApp(e, { theme });
      await click(treeItem('Trash'));
      await waitFor(() => !!document.querySelector('ul[aria-label="Deleted items"]'), 'trash');
    },
  },
  {
    name: 'folder tree with the context menu open',
    async run(e, theme) {
      await e.bridge.rpc('folders.create', { name: 'Work' });
      b = await bootApp(e, { theme, ready: () => !!treeItem('Work') });
      await act(async () =>
        treeItem('Work')!.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        ),
      );
      await waitFor(() => !!document.querySelector('[role=menu]'), 'menu');
    },
  },
  {
    name: 'command palette open',
    async run(e, theme) {
      await seed(e, 'Alpha');
      b = await bootApp(e, { theme });
      await press(document.body, 'k', { ctrlKey: true });
      await waitFor(() => !!document.querySelector('input[role=combobox]'), 'palette');
    },
  },
  {
    name: 'shortcuts view',
    async run(e, theme) {
      b = await bootApp(e, { theme });
      await press(document.body, 'F1');
      await waitFor(() => /Keyboard shortcuts/.test(text()), 'shortcuts');
    },
  },
  {
    name: 'confirm dialog (permanent delete)',
    async run(e, theme) {
      const [id] = await seed(e, 'Doomed');
      await trashOne(e, id!);
      b = await bootApp(e, { theme });
      await click(treeItem('Trash'));
      await waitFor(() => !!byText(document.body, 'Delete permanently…'), 'row');
      await click(byText(document.body, 'Delete permanently…'));
      await waitFor(() => !!document.querySelector('[role=alertdialog]'), 'dialog');
    },
  },
  {
    name: 'toast region with an Undo toast',
    async run(e, theme) {
      const [id] = await seed(e, 'Alpha', 'Beta');
      b = await bootApp(e, { theme });
      await act(async () => void (await b!.model().actions.deleteNote(id!, 'Alpha')));
      await waitFor(() => !!byText(document.body, 'Undo delete'), 'toast');
    },
  },
  {
    name: 'tag list',
    async run(e, theme) {
      await e.bridge.rpc('tags.create', { name: 'ideas' });
      await e.bridge.rpc('tags.create', { name: 'todo' });
      b = await bootApp(e, { theme });
      await waitFor(() => /ideas/.test(text()), 'tags');
    },
  },
  {
    name: 'focus mode',
    async run(e, theme) {
      await seed(e, 'Alpha\nbody');
      b = await bootApp(e, { theme, editor: 'real' });
      await openFirst();
      await press(document.body, 'f', { ctrlKey: true, shiftKey: true });
      expect(document.querySelector('nav')!.hasAttribute('hidden')).toBe(true);
    },
  },
  {
    name: 'capture window',
    async run(e, theme) {
      await e.bridge.rpc('prefs.set', { theme });
      extra = await mount(<CaptureApp bridge={e.bridge} onClose={() => {}} />);
      await waitFor(() => document.documentElement.dataset.theme === theme, 'theme');
      await waitFor(() => e.bridge.count('app.status') > 0, 'status');
    },
  },
  {
    name: 'fatal error screen',
    async run(e, theme) {
      applyTheme(theme);
      e.bridge.inject('app.status', {
        ok: true,
        value: { state: 'error', message: 'Workspace in use by another Mossnote.' },
      });
      b = await bootApp(e, { ready: () => /can’t open your notes/.test(text()) });
    },
  },
];

describe.each<Theme>(['light', 'dark'])(
  'axe: 0 serious or critical violations (%s theme)',
  (theme) => {
    it.each(scenarios)(
      '$name',
      async (s) => {
        env = makeEnv();
        await s.run(env, theme);
        // The saved theme must really be applied before judging the screen.
        if (s.name !== 'fatal error screen')
          expect(document.documentElement.dataset.theme).toBe(theme);
        const violations = await runAxe();
        expect(serious(violations)).toEqual([]);
        // Moderate and minor findings are not gated, except one known one: the splitters are grid
        // siblings of the landmarks, so axe's `region` rule lists them (and only them).
        const rest = violations.filter((v) => !serious([v]).length);
        for (const v of rest) {
          expect(v.id).toBe('region');
          expect(v.nodes.every((n) => n.startsWith('<div role="separator"'))).toBe(true);
        }
      },
      60_000,
    );
  },
);

describe('index.html', () => {
  it('declares the language and a title (the page-level axe rules)', () => {
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Mossnote');
  });
});

describe('axe integrity (the gate can fail)', () => {
  it('flags an unnamed button and a missing image alt', async () => {
    env = makeEnv();
    b = await bootApp(env);
    const bad = document.createElement('div');
    bad.innerHTML = '<button></button><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';
    document.body.append(bad);
    const ids = (await runAxe()).map((v) => v.id);
    bad.remove();
    expect(ids).toEqual(expect.arrayContaining(['button-name', 'image-alt']));
  }, 60_000);
});

/** Accessible name, close enough to the spec for our own markup. */
function nameOf(el: Element): string {
  const by = el.getAttribute('aria-labelledby');
  if (by)
    return by
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
  const label = el.getAttribute('aria-label');
  if (label) return label.trim();
  const labels = (el as HTMLInputElement).labels;
  if (labels?.length)
    return [...labels]
      .map((l) => l.textContent)
      .join(' ')
      .trim();
  return (el.textContent ?? el.getAttribute('title') ?? '').trim();
}
const CONTROLS =
  'button, input, select, textarea, [role=option], [role=treeitem], [role=separator], [role=combobox], [role=menuitem], [role=listbox], [role=tree], [role=dialog], [role=alertdialog]';

describe('landmarks, names and roles (AS-8, AS-16 automated part)', () => {
  it('the shell has named landmarks: nav, notes section, main, footer status', async () => {
    env = makeEnv();
    await seed(env, 'Alpha', 'Beta');
    b = await bootApp(env);
    const nav = document.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Folders and tags');
    expect(document.querySelectorAll('nav')).toHaveLength(1);
    const notes = document.querySelector('section#pane-list')!;
    expect(notes.getAttribute('aria-label')).toBe('Notes');
    const main = document.querySelectorAll('main');
    expect(main).toHaveLength(1);
    expect(main[0]!.getAttribute('aria-label')).toBe('Editor');
    const footer = document.querySelector('footer')!;
    expect(footer.getAttribute('aria-label')).toBe('Status');
    expect(footer.parentElement!.closest('section, article, aside, nav, main')).toBeNull();
    expect(footer.textContent).toContain('Sync: Not paired');
    // One h1 (the brand) so the page has a heading outline.
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('every control in the shell, palette, trash and dialogs has an accessible name', async () => {
    env = makeEnv();
    const [a] = await seed(env, 'Alpha', 'Beta');
    await env.bridge.rpc('tags.create', { name: 'ideas' });
    await env.bridge.rpc('folders.create', { name: 'Work' });
    await trashOne(env, (await seed(env, 'Gone'))[0]!);
    b = await bootApp(env, { editor: 'real' });
    await click(noteOptions().find((o) => o.id === `note-${a}`));
    await waitFor(cmReady, 'editor');
    const check = (what: string) => {
      const unnamed = [...document.querySelectorAll(CONTROLS)]
        .filter((el) => !el.closest('[hidden]') && !el.closest('.cm-editor'))
        .filter((el) => nameOf(el) === '')
        .map((el) => el.outerHTML.slice(0, 100));
      expect(unnamed, what).toEqual([]);
    };
    check('shell');
    expect(document.querySelector('.cm-content')!.getAttribute('aria-label')).toBe('Note editor');
    await press(document.body, 'k', { ctrlKey: true });
    await waitFor(() => !!document.querySelector('input[role=combobox]'), 'palette');
    check('palette');
    await press(document.querySelector('input[role=combobox]')!, 'Escape');
    await click(treeItem('Trash'));
    await waitFor(() => !!byText(document.body, 'Restore'), 'trash row');
    check('trash');
    await click(byText(document.body, 'Delete permanently…'));
    check('confirm dialog');
  }, 60_000);

  it('list, tree and the splitters use the right roles and state attributes', async () => {
    env = makeEnv();
    await seed(env, 'Alpha', 'Beta');
    await env.bridge.rpc('folders.create', { name: 'Work' });
    b = await bootApp(env, { ready: () => !!treeItem('Work') && noteOptions().length === 2 });
    const list = document.querySelector('ul[aria-label="Notes"]')!;
    expect(list.getAttribute('role')).toBe('listbox');
    expect([...list.children].every((c) => c.getAttribute('role') === 'option')).toBe(true);
    expect(noteOptions().filter((o) => o.getAttribute('tabindex') === '0')).toHaveLength(1);
    const tree = document.querySelector('[role=tree]')!;
    expect(tree.getAttribute('aria-label')).toBe('Folders');
    const items = [...tree.children];
    expect(items.every((c) => c.getAttribute('role') === 'treeitem')).toBe(true);
    expect(items.every((c) => c.getAttribute('aria-level') === '1')).toBe(true);
    expect(items.filter((c) => c.getAttribute('tabindex') === '0')).toHaveLength(1);
    const seps = [...document.querySelectorAll('[role=separator]')];
    expect(seps.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Resize sidebar',
      'Resize note list',
    ]);
    for (const s of seps) {
      expect(s.getAttribute('tabindex')).toBe('0');
      expect(s.getAttribute('aria-valuenow')).toMatch(/^\d+$/);
      expect(document.getElementById(s.getAttribute('aria-controls')!)).not.toBeNull();
    }
    // The formatting toolbar (role=toolbar) exists only while a note is open; none is open here.
    expect(document.querySelector('[role=toolbar]')).toBeNull();
  });

  it('one live-region policy: SaveStatus speaks only errors and recovery; toasts are role=status', async () => {
    env = makeEnv();
    b = await bootApp(env);
    // No assertive regions and no log regions anywhere in the shell.
    expect(document.querySelectorAll('[aria-live=assertive], [role=log]')).toHaveLength(0);
    const region = document.querySelector('footer [role=status]')!;
    const spoken = () => region.textContent;
    const store = b.model().store;
    const step = async (save: Parameters<typeof store.set>[0]) =>
      act(async () => void store.set(save));
    await step({ save: { kind: 'saving' } });
    expect(spoken()).toBe('');
    await step({ save: { kind: 'saved' } });
    expect(spoken()).toBe('');
    await step({ save: { kind: 'error', code: 'io', message: 'disk full' } });
    expect(spoken()).toBe('Not saved: disk full');
    await step({ save: { kind: 'saved' } });
    expect(spoken()).toBe('Saved');
    // The toast region is the other (and only other) polite status region.
    const toasts = document.querySelector('.toasts')!;
    expect(toasts.getAttribute('role')).toBe('status');
    expect(toasts.getAttribute('aria-live')).toBe('polite');
    await act(async () => void b!.model().toasts.push({ message: 'Hello there' }));
    expect(toasts.textContent).toContain('Hello there');
    const live = [...document.querySelectorAll('[aria-live], [role=status], [role=alert]')];
    expect(live.filter((l) => l.getAttribute('aria-live') === 'assertive')).toHaveLength(0);
  });
});
