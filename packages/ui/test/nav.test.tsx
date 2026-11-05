// @vitest-environment jsdom
import { act } from 'react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Folder } from '@mossnote/core/rpc';
import { FavoriteButton } from '../src/nav/FavoriteButton';
import { FolderTree } from '../src/nav/FolderTree';
import { createNavStore, selectionToListArgs } from '../src/nav/navStore';
import { NoteTags } from '../src/nav/NoteTags';
import { TagList } from '../src/nav/TagList';
import { createClient } from '../src/rpc/client';
import { createToastStore } from '../src/toast/toastStore';
import { createTrashActions } from '../src/trash/trashActions';
import { byText, click, mount, press, settle, waitFor, type Mounted } from './helpers/dom';
import { makeEnv, type Env } from './helpers/workspace';

let env: Env;
let m: Mounted | undefined;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await m?.unmount();
  m = undefined;
  env.cleanup();
});

const setup = () => {
  const client = createClient(env.bridge);
  const nav = createNavStore();
  const toasts = createToastStore();
  const actions = createTrashActions({ client, toasts });
  return { client, nav, toasts, actions };
};
const mk = async (name: string, parentId: string | null = null) => {
  const r = await createClient(env.bridge).call('folders.create', { name, parentId });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const items = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[role=treeitem]')];
const item = (el: HTMLElement, text: string) =>
  items(el).find((i) => i.textContent?.replace(/^[▸▾\s]+/, '').startsWith(text));
const focus = async (el: HTMLElement | undefined) => {
  if (!el) throw new Error('missing element');
  await act(async () => el.focus());
};
const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const axeSerious = async (el: HTMLElement) => {
  const r = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
};

describe('navStore', () => {
  it('maps each selection to notes.list args and select() drops a stale id', () => {
    expect(selectionToListArgs({ kind: 'all' })).toEqual({});
    expect(selectionToListArgs({ kind: 'favorites' })).toEqual({ favorite: true });
    expect(selectionToListArgs({ kind: 'trash' })).toEqual({ trashed: true });
    expect(selectionToListArgs({ kind: 'tag', id: 't1' })).toEqual({ tagId: 't1' });
    expect(selectionToListArgs({ kind: 'folder', id: 'f1' })).toEqual({ folderId: 'f1' });
    const nav = createNavStore();
    nav.select({ kind: 'folder', id: 'f1' });
    nav.select({ kind: 'favorites' });
    expect(nav.get()).toEqual({ kind: 'favorites', id: undefined });
  });
  it('the args are accepted by the real notes.list (and filter correctly)', async () => {
    const { client } = setup();
    const f = await mk('F');
    await client.call('notes.create', { folderId: f.id, body: 'in folder' });
    await client.call('notes.create', { body: 'loose' });
    const r = await client.call('notes.list', selectionToListArgs({ kind: 'folder', id: f.id }));
    expect(r.ok && r.value.map((n) => n.title)).toEqual(['in folder']);
  });
});

describe('FolderTree', () => {
  it('is a tree with fixed entries, a Trash count, aria-expanded and one tab stop', async () => {
    const a = await mk('Alpha');
    await mk('Child', a.id);
    const { client, nav, actions } = setup();
    const n = await client.call('notes.create', { body: 'x' });
    if (!n.ok) throw new Error('create');
    await client.call('notes.trash', { id: n.value.id });
    m = await mount(<FolderTree client={client} nav={nav} actions={actions} />);
    await waitFor(() => !!item(m!.el, 'Alpha'), 'folders');
    const tree = m.el.querySelector('[role=tree]')!;
    expect(tree).toBeTruthy();
    expect(items(m.el).map((i) => i.textContent?.replace(/^[▸▾\s]+/, ''))).toEqual([
      'All notes',
      'Favorites',
      'Alpha',
      expect.stringMatching(/^Trash/),
    ]);
    await waitFor(() => /\(1\)/.test(item(m!.el, 'Trash')!.textContent!), 'trash count');
    expect(item(m.el, 'Alpha')!.getAttribute('aria-expanded')).toBe('false');
    expect(item(m.el, 'All notes')!.hasAttribute('aria-expanded')).toBe(false);
    expect(items(m.el).filter((i) => i.tabIndex === 0)).toHaveLength(1);
  });

  it('keyboard only: arrows, Left/Right expand/collapse/jump, Home/End, Enter selects', async () => {
    const a = await mk('Alpha');
    await mk('Child', a.id);
    await mk('Beta');
    const { client, nav, actions } = setup();
    m = await mount(<FolderTree client={client} nav={nav} actions={actions} />);
    await waitFor(() => !!item(m!.el, 'Beta'), 'folders');
    const el = m.el;
    await focus(item(el, 'All notes'));
    await press(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(item(el, 'Favorites'));
    await press(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(item(el, 'Alpha'));
    await press(document.activeElement!, 'ArrowRight'); // expand
    expect(item(el, 'Alpha')!.getAttribute('aria-expanded')).toBe('true');
    expect(item(el, 'Child')).toBeTruthy();
    await press(document.activeElement!, 'ArrowRight'); // into the first child
    expect(document.activeElement).toBe(item(el, 'Child'));
    expect(document.activeElement!.getAttribute('aria-level')).toBe('2');
    await press(document.activeElement!, 'ArrowLeft'); // back to the parent
    expect(document.activeElement).toBe(item(el, 'Alpha'));
    await press(document.activeElement!, 'ArrowLeft'); // collapse
    expect(item(el, 'Alpha')!.getAttribute('aria-expanded')).toBe('false');
    expect(item(el, 'Child')).toBeUndefined();
    await press(document.activeElement!, 'End');
    expect(document.activeElement).toBe(item(el, 'Trash'));
    await press(document.activeElement!, 'Home');
    expect(document.activeElement).toBe(item(el, 'All notes'));
    // roving tabindex follows focus
    expect(items(el).filter((i) => i.tabIndex === 0)).toEqual([item(el, 'All notes')]);
    await press(document.activeElement!, 'ArrowDown');
    await press(document.activeElement!, 'ArrowDown');
    await press(document.activeElement!, 'Enter');
    expect(nav.get()).toMatchObject({ kind: 'folder', id: a.id });
    expect(item(el, 'Alpha')!.getAttribute('aria-selected')).toBe('true');
    await press(item(el, 'Trash')!, 'Enter');
    expect(nav.get().kind).toBe('trash');
  });

  it('F2 renames inline: Enter saves, Esc cancels without calling the RPC', async () => {
    const a = await mk('Alpha');
    const { client, nav, actions } = setup();
    m = await mount(<FolderTree client={client} nav={nav} actions={actions} />);
    await waitFor(() => !!item(m!.el, 'Alpha'), 'folders');
    await focus(item(m.el, 'Alpha'));
    await press(document.activeElement!, 'F2');
    let input = m.el.querySelector('input')!;
    expect(document.activeElement).toBe(input);
    await typeInto(input, 'Nope');
    await press(input, 'Escape');
    expect(m.el.querySelector('input')).toBeNull();
    expect(env.bridge.count('folders.rename')).toBe(0);
    expect(document.activeElement).toBe(item(m.el, 'Alpha'));

    await press(document.activeElement!, 'F2');
    input = m.el.querySelector('input')!;
    await typeInto(input, 'Renamed');
    await press(input, 'Enter');
    await waitFor(() => !!item(m!.el, 'Renamed'), 'renamed row');
    const l = await client.call('folders.list');
    expect(l.ok && l.value.find((f) => f.id === a.id)?.name).toBe('Renamed');
    expect(document.activeElement).toBe(item(m.el, 'Renamed'));
  });

  it('a rename the core rejects stays open and explains why', async () => {
    await mk('Alpha');
    const { client, nav, actions } = setup();
    m = await mount(<FolderTree client={client} nav={nav} actions={actions} />);
    await waitFor(() => !!item(m!.el, 'Alpha'), 'folders');
    await focus(item(m.el, 'Alpha'));
    await press(document.activeElement!, 'F2');
    const input = m.el.querySelector('input')!;
    await typeInto(input, '   ');
    await press(input, 'Enter');
    expect(m.el.querySelector('[role=alert]')?.textContent).toMatch(/needs a name/);
    expect(m.el.querySelector('input')).not.toBeNull();
    expect(env.bridge.count('folders.rename')).toBe(0);
  });

  it('New folder creates it and opens it for naming', async () => {
    const { client, nav, actions } = setup();
    m = await mount(<FolderTree client={client} nav={nav} actions={actions} />);
    await click(byText(m.el, 'New folder'));
    await waitFor(() => !!m!.el.querySelector('input'), 'rename input');
    const input = m.el.querySelector('input')!;
    await typeInto(input, 'Projects');
    await press(input, 'Enter');
    await waitFor(() => !!item(m!.el, 'Projects'), 'new row');
    const l = await client.call('folders.list');
    expect(l.ok && l.value.map((f) => f.name)).toEqual(['Projects']);
  });

  it('Delete moves the folder to Trash with an undo toast and focus lands on the neighbour', async () => {
    const a = await mk('Alpha');
    await mk('Beta');
    const { client, nav, actions, toasts } = setup();
    m = await mount(<FolderTree client={client} nav={nav} actions={actions} />);
    await waitFor(() => !!item(m!.el, 'Beta'), 'folders');
    nav.select({ kind: 'folder', id: a.id });
    await focus(item(m.el, 'Alpha'));
    await press(document.activeElement!, 'Delete');
    await waitFor(() => !item(m!.el, 'Alpha'), 'row gone');
    expect(toasts.get().toasts.map((t) => t.message)).toEqual(['Moved "Alpha" to Trash.']);
    expect(toasts.get().toasts[0]!.actionLabel).toBe('Undo delete');
    expect(document.activeElement).toBe(item(m.el, 'Beta'));
    expect(nav.get().kind).toBe('all'); // the selected folder vanished
    await waitFor(() => /\(1\)/.test(item(m!.el, 'Trash')!.textContent!), 'trash count');
  });

  it('"Move to…" (ContextMenu key) moves a folder; itself and its subtree are not offered', async () => {
    const a = await mk('Alpha');
    const c = await mk('Child', a.id);
    const b = await mk('Beta');
    const { client, nav, actions } = setup();
    m = await mount(<FolderTree client={client} nav={nav} actions={actions} />);
    await waitFor(() => !!item(m!.el, 'Beta'), 'folders');
    await focus(item(m.el, 'Alpha'));
    await press(document.activeElement!, 'ContextMenu');
    const menu = m.el.querySelector('[role=menu]')!;
    expect(menu).toBeTruthy();
    expect([...menu.querySelectorAll('[role=menuitem]')].map((x) => x.textContent)).toEqual([
      'New subfolder',
      'Rename',
      'Move to…',
      'Move to Trash',
    ]);
    expect(document.activeElement!.textContent).toBe('New subfolder');
    await press(document.activeElement!, 'ArrowDown');
    await press(document.activeElement!, 'ArrowDown');
    expect(document.activeElement!.textContent).toBe('Move to…');
    await press(document.activeElement!, 'Enter');
    const dlg = m.el.querySelector('[role=dialog]')!;
    expect(dlg.getAttribute('aria-labelledby')).toBeTruthy();
    await waitFor(() => dlg.querySelectorAll('option').length > 1, 'options');
    const opts = [...dlg.querySelectorAll('option')].map((o) => o.textContent!.trim());
    expect(opts).toEqual(['Top level', 'Beta']); // not Alpha, not Child
    const select = dlg.querySelector('select')!;
    await act(async () => {
      select.value = b.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(byText(dlg as HTMLElement, 'Move'));
    await waitFor(() => !m!.el.querySelector('[role=dialog]'), 'dialog closed');
    const l = await client.call('folders.list');
    expect(l.ok && l.value.find((f) => f.id === a.id)?.parentId).toBe(b.id);
    expect(l.ok && l.value.find((f) => f.id === c.id)?.parentId).toBe(a.id);
  });

  it('Esc inside the menu closes it and returns focus to the folder', async () => {
    await mk('Alpha');
    const { client, nav, actions } = setup();
    m = await mount(<FolderTree client={client} nav={nav} actions={actions} />);
    await waitFor(() => !!item(m!.el, 'Alpha'), 'folders');
    await focus(item(m.el, 'Alpha'));
    await press(document.activeElement!, 'F10', { shiftKey: true });
    expect(m.el.querySelector('[role=menu]')).toBeTruthy();
    await press(document.activeElement!, 'Escape');
    expect(m.el.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(item(m.el, 'Alpha'));
  });

  it('nests to depth 50 and keeps navigating', async () => {
    let parent: string | null = null;
    for (let i = 1; i <= 50; i++) parent = (await mk(`L${i}`, parent)).id;
    const { client, nav, actions } = setup();
    m = await mount(<FolderTree client={client} nav={nav} actions={actions} />);
    await waitFor(() => !!item(m!.el, 'L1'), 'folders');
    await focus(item(m.el, 'L1'));
    for (let i = 1; i < 50; i++) {
      await press(document.activeElement!, 'ArrowRight'); // expand
      await press(document.activeElement!, 'ArrowRight'); // into the child
    }
    expect(document.activeElement!.textContent).toMatch(/L50$/);
    expect(document.activeElement!.getAttribute('aria-level')).toBe('50');
  });

  it('10 000 sibling folders render and arrow keys stay fast', async () => {
    const folders: Folder[] = Array.from({ length: 10_000 }, (_, i) => ({
      id: `f${i}`,
      parentId: null,
      name: `Folder ${String(i).padStart(5, '0')}`,
      createdAt: 1,
      updatedAt: 1,
      deviceId: 'd',
      trashedAt: null,
      trashed: false,
    }));
    env.bridge.inject('folders.list', { ok: true, value: folders });
    const { client, nav, actions } = setup();
    const t0 = performance.now();
    m = await mount(<FolderTree client={client} nav={nav} actions={actions} />);
    await waitFor(() => items(m!.el).length > 10_000, 'rows');
    const render = performance.now() - t0;
    await focus(item(m.el, 'Folder 00000'));
    const t1 = performance.now();
    for (let i = 0; i < 30; i++) await press(document.activeElement!, 'ArrowDown');
    const keys = performance.now() - t1;
    expect(document.activeElement!.textContent).toMatch(/Folder 00030$/);
    expect(render).toBeLessThan(8000);
    expect(keys).toBeLessThan(4000);
  }, 60_000);

  it('has no serious or critical axe violations', async () => {
    const a = await mk('Alpha');
    await mk('Child', a.id);
    const { client, nav, actions } = setup();
    m = await mount(<FolderTree client={client} nav={nav} actions={actions} />);
    await waitFor(() => !!item(m!.el, 'Alpha'), 'folders');
    await press(item(m.el, 'Alpha')!, 'ArrowRight');
    expect(await axeSerious(m.el)).toEqual([]);
    await focus(item(m.el, 'Alpha'));
    await press(document.activeElement!, 'ContextMenu');
    expect(await axeSerious(m.el)).toEqual([]);
  });
});

describe('TagList', () => {
  const tagNames = async () => {
    const r = await createClient(env.bridge).call('tags.list');
    return r.ok ? r.value.map((t) => t.name).sort() : [];
  };
  const seed = async (...names: string[]) => {
    for (const name of names) await createClient(env.bridge).call('tags.create', { name });
  };
  const renameVia = async (el: HTMLElement, from: string, to: string) => {
    await click(el.querySelector(`button[aria-label="Rename tag ${from}"]`));
    const input = el.querySelector<HTMLInputElement>(`input[aria-label="Rename tag ${from}"]`)!;
    await typeInto(input, to);
    await press(input, 'Enter');
  };

  it('lists, creates, renames and selects tags', async () => {
    await seed('alpha');
    const { client, nav } = setup();
    m = await mount(<TagList client={client} nav={nav} />);
    await waitFor(() => !!byText(m!.el, 'alpha'), 'tags');
    await typeInto(m.el.querySelector('input')!, 'beta');
    await click(byText(m.el, 'Add tag'));
    await waitFor(() => !!byText(m!.el, 'beta'), 'created');
    await renameVia(m.el, 'alpha', 'gamma');
    await waitFor(() => !!byText(m!.el, 'gamma'), 'renamed');
    expect(await tagNames()).toEqual(['beta', 'gamma']);
    await click(byText(m.el, 'gamma'));
    expect(nav.get().kind).toBe('tag');
    expect(byText(m.el, 'gamma')!.getAttribute('aria-current')).toBe('true');
  });

  it('Esc cancels a tag rename', async () => {
    await seed('alpha');
    const { client, nav } = setup();
    m = await mount(<TagList client={client} nav={nav} />);
    await waitFor(() => !!byText(m!.el, 'alpha'), 'tags');
    await click(m.el.querySelector('button[aria-label="Rename tag alpha"]'));
    const input = m.el.querySelector<HTMLInputElement>('input[aria-label="Rename tag alpha"]')!;
    await typeInto(input, 'zzz');
    await press(input, 'Escape');
    expect(env.bridge.count('tags.rename')).toBe(0);
    expect(await tagNames()).toEqual(['alpha']);
  });

  it('renaming onto an existing tag never merges without the confirm button', async () => {
    await seed('alpha', 'beta');
    const client0 = createClient(env.bridge);
    const al = await client0.call('tags.list');
    const alpha = al.ok ? al.value.find((t) => t.name === 'alpha')! : null;
    const n = await client0.call('notes.create', { body: 'tagged' });
    if (!n.ok || !alpha) throw new Error('seed');
    await client0.call('tags.tagNote', { noteId: n.value.id, tagId: alpha.id });
    const { client, nav } = setup();
    m = await mount(<TagList client={client} nav={nav} />);
    await waitFor(() => !!byText(m!.el, 'alpha'), 'tags');

    await renameVia(m.el, 'alpha', 'Beta');
    await waitFor(() => !!m!.el.querySelector('[role=alertdialog]'), 'merge dialog');
    const dlg = m.el.querySelector('[role=alertdialog]')!;
    expect(dlg.textContent).toContain('"alpha"');
    expect(dlg.textContent).toContain('"beta"');
    expect(document.activeElement).toBe(byText(dlg as HTMLElement, 'Cancel'));
    // Before any confirm: nothing merged, no confirmMerge sent.
    expect(env.bridge.calls.some((c) => JSON.stringify(c.args).includes('confirmMerge'))).toBe(
      false,
    );
    expect(await tagNames()).toEqual(['alpha', 'beta']);

    await click(byText(dlg as HTMLElement, 'Cancel'));
    expect(m.el.querySelector('[role=alertdialog]')).toBeNull();
    expect(await tagNames()).toEqual(['alpha', 'beta']);
    expect(env.bridge.calls.some((c) => JSON.stringify(c.args).includes('confirmMerge'))).toBe(
      false,
    );

    await renameVia(m.el, 'alpha', 'Beta');
    await waitFor(() => !!m!.el.querySelector('[role=alertdialog]'), 'merge dialog again');
    await press(m.el.querySelector('[role=alertdialog]')!, 'Escape');
    expect(await tagNames()).toEqual(['alpha', 'beta']);

    await renameVia(m.el, 'alpha', 'Beta');
    await waitFor(() => !!m!.el.querySelector('[role=alertdialog]'), 'merge dialog 3');
    await click(byText(m.el.querySelector('[role=alertdialog]') as HTMLElement, 'Merge tags'));
    await waitFor(() => !m!.el.querySelector('[role=alertdialog]'), 'closed');
    expect(await tagNames()).toEqual(['beta']);
    const tagged = await client0.call('tags.forNote', { noteId: n.value.id });
    expect(tagged.ok && tagged.value.map((t) => t.name)).toEqual(['beta']);
  });

  it('has no serious or critical axe violations (list and merge dialog)', async () => {
    await seed('alpha', 'beta');
    const { client, nav } = setup();
    m = await mount(<TagList client={client} nav={nav} />);
    await waitFor(() => !!byText(m!.el, 'alpha'), 'tags');
    expect(await axeSerious(m.el)).toEqual([]);
    await renameVia(m.el, 'alpha', 'beta');
    await waitFor(() => !!m!.el.querySelector('[role=alertdialog]'), 'dialog');
    expect(await axeSerious(m.el)).toEqual([]);
  });
});

describe('NoteTags and FavoriteButton', () => {
  it('tags a note with an existing tag, creates a new one on the fly, removes one', async () => {
    const { client } = setup();
    await client.call('tags.create', { name: 'Work' });
    const n = await client.call('notes.create', { body: 'hello' });
    if (!n.ok) throw new Error('create');
    m = await mount(<NoteTags client={client} noteId={n.value.id} />);
    const add = async (name: string) => {
      const input = m!.el.querySelector<HTMLInputElement>('input[aria-label="Add tag"]')!;
      await typeInto(input, name);
      await click(byText(m!.el, 'Add'));
    };
    await add('work'); // case-insensitive match, no duplicate tag
    await waitFor(() => !!m!.el.querySelector('[aria-label="Remove tag Work"]'), 'tagged');
    await add('fresh');
    await waitFor(() => !!m!.el.querySelector('[aria-label="Remove tag fresh"]'), 'created');
    const all = await client.call('tags.list');
    expect(all.ok && all.value.map((t) => t.name).sort()).toEqual(['Work', 'fresh']);
    await click(m.el.querySelector('[aria-label="Remove tag Work"]'));
    await waitFor(() => !m!.el.querySelector('[aria-label="Remove tag Work"]'), 'untagged');
    const mine = await client.call('tags.forNote', { noteId: n.value.id });
    expect(mine.ok && mine.value.map((t) => t.name)).toEqual(['fresh']);
    expect(await axeSerious(m.el)).toEqual([]);
  });

  it('read-only hides the controls', async () => {
    const { client } = setup();
    m = await mount(<NoteTags client={client} noteId="n1" readOnly />);
    await settle();
    expect(m.el.querySelector('input')).toBeNull();
  });

  it('the favorite toggle flips the note and reports the new summary', async () => {
    const { client } = setup();
    const n = await client.call('notes.create', { body: 'fav me' });
    if (!n.ok) throw new Error('create');
    const seen: boolean[] = [];
    m = await mount(
      <FavoriteButton
        client={client}
        noteId={n.value.id}
        favorite={false}
        onChange={(s) => seen.push(s.favorite)}
      />,
    );
    expect(m.el.querySelector('button')!.getAttribute('aria-pressed')).toBe('false');
    await click(m.el.querySelector('button'));
    await waitFor(() => seen.length === 1, 'toggled');
    expect(seen).toEqual([true]);
    const r = await client.call('notes.list', selectionToListArgs({ kind: 'favorites' }));
    expect(r.ok && r.value.map((x) => x.id)).toEqual([n.value.id]);
  });
});
