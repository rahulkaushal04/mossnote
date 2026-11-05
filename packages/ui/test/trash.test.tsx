// @vitest-environment jsdom
import { act } from 'react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '../src/rpc/client';
import { createToastStore } from '../src/toast/toastStore';
import { createTrashActions } from '../src/trash/trashActions';
import { isReadOnlyNote, isTrashedError, TrashedNoteBanner } from '../src/trash/TrashedNoteBanner';
import { TrashView } from '../src/trash/TrashView';
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

const client = () => createClient(env.bridge);
const note = async (body: string, folderId: string | null = null) => {
  const r = await client().call('notes.create', { body, folderId });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const trashNote = async (id: string) => {
  const r = await client().call('notes.trash', { id });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.batchId;
};
const trashList = async () => {
  const r = await client().call('trash.list');
  return r.ok ? r.value.map((i) => i.label) : [];
};
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('li[data-batch]')];
const row = (el: HTMLElement, label: string) =>
  rows(el).find((r) => r.querySelector('span')?.textContent === label);
const axeSerious = async (el: HTMLElement) => {
  const r = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
};
const dialog = () => document.querySelector<HTMLElement>('[role=alertdialog]');

describe('TrashView states', () => {
  it('shows Loading while trash.list is pending', async () => {
    const hold = env.bridge.hold('trash.list');
    m = await mount(<TrashView client={client()} />);
    expect(m.el.textContent).toContain('Loading Trash');
    await act(async () => hold.release());
    await waitFor(() => !m!.el.textContent!.includes('Loading Trash'), 'loaded');
  });

  it('error state offers Retry, which recovers', async () => {
    env.bridge.inject('trash.list', { ok: false, error: { code: 'io', message: 'disk on fire' } });
    m = await mount(<TrashView client={client()} />);
    await waitFor(() => !!m!.el.querySelector('[role=alert]'), 'error');
    expect(m.el.textContent).toContain('disk on fire');
    await note('kept').then((n) => trashNote(n.id));
    await click(byText(m.el, 'Retry'));
    await waitFor(() => rows(m!.el).length === 1, 'recovered');
    expect(await axeSerious(m.el)).toEqual([]);
  });

  it('empty state explains itself and offers a way back', async () => {
    let back = 0;
    m = await mount(<TrashView client={client()} onBack={() => back++} />);
    await waitFor(() => m!.el.textContent!.includes('Trash is empty'), 'empty');
    await click(byText(m.el, 'Back to all notes'));
    expect(back).toBe(1);
  });
});

describe('TrashView actions', () => {
  it('lists trashed items with entity and Restore brings the note back', async () => {
    const n = await note('Groceries');
    await trashNote(n.id);
    const restored: string[] = [];
    m = await mount(<TrashView client={client()} onRestored={(i, msg) => restored.push(msg)} />);
    await waitFor(() => rows(m!.el).length === 1, 'row');
    expect(row(m.el, 'Groceries')!.textContent).toContain('Note');
    await click(byText(m.el, 'Restore'));
    await waitFor(() => rows(m!.el).length === 0, 'row gone');
    const l = await client().call('notes.list', {});
    expect(l.ok && l.value.map((x) => x.title)).toEqual(['Groceries']);
    expect(m.el.querySelector('[role=status]')!.textContent).toBe(
      'Restored "Groceries" at the top level.',
    );
    expect(restored).toEqual(['Restored "Groceries" at the top level.']);
  });

  it('restoring a note whose folder is in Trash says where it landed', async () => {
    const f = await client().call('folders.create', { name: 'Work', parentId: null });
    if (!f.ok) throw new Error('folder');
    const n = await note('Report', f.value.id);
    await trashNote(n.id); // its own batch, then its folder goes too
    await client().call('folders.trash', { id: f.value.id });
    m = await mount(<TrashView client={client()} />);
    await waitFor(() => rows(m!.el).length === 2, 'rows');
    await click(row(m.el, 'Report')!.querySelector('button[aria-label^="Restore"]'));
    await waitFor(() => /Restored "Report"/.test(m!.el.textContent!), 'notice');
    expect(m.el.querySelector('[role=status]')!.textContent).toBe(
      'Restored "Report" at the top level.',
    );
    const got = await client().call('notes.get', { id: n.id });
    expect(got.ok && got.value.folderId).toBeNull();
    expect(got.ok && got.value.trashed).toBe(false);
  });

  it('restoring a note into a live folder names the folder', async () => {
    const f = await client().call('folders.create', { name: 'Work', parentId: null });
    if (!f.ok) throw new Error('folder');
    const n = await note('Report', f.value.id);
    await trashNote(n.id);
    m = await mount(<TrashView client={client()} />);
    await waitFor(() => rows(m!.el).length === 1, 'row');
    await click(byText(m.el, 'Restore'));
    await waitFor(() => /Restored/.test(m!.el.textContent!), 'notice');
    expect(m.el.querySelector('[role=status]')!.textContent).toBe('Restored "Report" in "Work".');
  });

  it('permanent delete: the dialog names the item; Cancel and Esc purge nothing', async () => {
    const n = await note('Groceries');
    await trashNote(n.id);
    m = await mount(<TrashView client={client()} />);
    await waitFor(() => rows(m!.el).length === 1, 'row');
    const opener = byText(m.el, 'Delete permanently…')!;
    await act(async () => opener.focus());
    await click(opener);
    const d = dialog()!;
    expect(d.getAttribute('role')).toBe('alertdialog');
    expect(document.getElementById(d.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Permanently delete "Groceries"? This cannot be undone.',
    );
    expect(document.activeElement).toBe(byText(d, 'Cancel'));

    await click(byText(d, 'Cancel'));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    await click(opener);
    await press(document.activeElement!, 'Escape');
    expect(dialog()).toBeNull();
    expect(env.bridge.count('trash.purge')).toBe(0);
    expect(await trashList()).toEqual(['Groceries']);
    expect(rows(m.el)).toHaveLength(1);
  });

  it('confirming purges: gone from trash.list, the view and the database', async () => {
    const n = await note('Groceries');
    await trashNote(n.id);
    const keep = await note('Keep');
    await trashNote(keep.id);
    m = await mount(<TrashView client={client()} />);
    await waitFor(() => rows(m!.el).length === 2, 'rows');
    await click(row(m.el, 'Groceries')!.querySelector('button[aria-label^="Delete"]'));
    await click(byText(dialog()!, 'Delete permanently'));
    await waitFor(() => rows(m!.el).length === 1, 'row gone');
    expect(env.bridge.calls.find((c) => c.method === 'trash.purge')?.args).toMatchObject({
      confirmed: true,
    });
    expect(await trashList()).toEqual(['Keep']);
    const g = await client().call('notes.get', { id: n.id });
    expect(g.ok).toBe(false);
    expect(m.el.querySelector('[role=status]')!.textContent).toBe(
      'Permanently deleted "Groceries".',
    );
    expect(dialog()).toBeNull();
  });

  it('keyboard only: arrows move, Enter restores, Delete asks, Esc cancels', async () => {
    for (const t of ['Aaa', 'Bbb', 'Ccc']) await note(t).then((n) => trashNote(n.id));
    m = await mount(<TrashView client={client()} />);
    await waitFor(() => rows(m!.el).length === 3, 'rows');
    const first = rows(m.el)[0]!;
    await act(async () => first.focus());
    expect(rows(m.el).filter((r) => r.tabIndex === 0)).toHaveLength(1);
    await press(first, 'ArrowDown');
    const second = rows(m.el)[1]!;
    expect(document.activeElement).toBe(second);
    await press(second, 'End');
    expect(document.activeElement).toBe(rows(m.el)[2]);
    await press(document.activeElement!, 'Home');
    expect(document.activeElement).toBe(rows(m.el)[0]);
    await press(document.activeElement!, 'ArrowDown');
    const label = document.activeElement!.querySelector('span')!.textContent!;
    await press(document.activeElement!, 'Delete');
    expect(dialog()!.textContent).toContain(`Permanently delete "${label}"?`);
    await press(document.activeElement!, 'Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement!.querySelector('span')!.textContent).toBe(label); // back on the row
    await press(document.activeElement!, 'Enter');
    await waitFor(() => rows(m!.el).length === 2, 'restored');
    expect(await trashList()).not.toContain(label);
    const live = await client().call('notes.list', {});
    expect(live.ok && live.value.map((n) => n.title)).toEqual([label]);
    // focus did not fall to <body>
    expect(m.el.contains(document.activeElement)).toBe(true);
  });

  it('a delete made elsewhere shows up without a refresh (changed event)', async () => {
    const toasts = createToastStore();
    const actions = createTrashActions({ client: client(), toasts });
    m = await mount(<TrashView client={client()} />);
    await waitFor(() => m!.el.textContent!.includes('Trash is empty'), 'empty');
    const n = await note('Fresh');
    await act(async () => void (await actions.deleteNote(n.id)));
    await waitFor(() => rows(m!.el).length === 1, 'row appears');
  });

  it('has no serious or critical axe violations (list and dialog)', async () => {
    const n = await note('Groceries');
    await trashNote(n.id);
    m = await mount(<TrashView client={client()} onOpenNote={() => {}} />);
    await waitFor(() => rows(m!.el).length === 1, 'row');
    expect(await axeSerious(m.el)).toEqual([]);
    await click(byText(m.el, 'Delete permanently…'));
    expect(await axeSerious(document.body)).toEqual([]);
  });
});

describe('read-only trashed note contract', () => {
  it('core refuses saves to a trashed note with the "trashed" code', async () => {
    const n = await note('Original');
    await trashNote(n.id);
    const got = await client().call('notes.get', { id: n.id });
    if (!got.ok) throw new Error('get');
    expect(isReadOnlyNote(got.value)).toBe(true);
    const r = await client().call('notes.save', {
      id: n.id,
      body: 'edited',
      expectedContentHash: got.value.contentHash,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && isTrashedError(r.error)).toBe(true);
    expect(isReadOnlyNote({ trashed: false })).toBe(false);
    expect(isReadOnlyNote(null)).toBe(false);
  });

  it('the banner restores the note and reports it', async () => {
    const n = await note('Original');
    await trashNote(n.id);
    let restored = 0;
    m = await mount(
      <TrashedNoteBanner client={client()} noteId={n.id} onRestored={() => restored++} />,
    );
    expect(m.el.textContent).toContain('read-only');
    await click(byText(m.el, 'Restore note'));
    await settle(20);
    expect(restored).toBe(1);
    const got = await client().call('notes.get', { id: n.id });
    expect(got.ok && got.value.trashed).toBe(false);
    expect(await axeSerious(m.el)).toEqual([]);
  });

  it('a note trashed only through its folder explains and points to Trash', async () => {
    const f = await client().call('folders.create', { name: 'Work', parentId: null });
    if (!f.ok) throw new Error('folder');
    const n = await note('Inside', f.value.id);
    await client().call('folders.trash', { id: f.value.id });
    let opened = 0;
    m = await mount(
      <TrashedNoteBanner
        client={client()}
        noteId={n.id}
        onRestored={() => {}}
        onOpenTrash={() => opened++}
      />,
    );
    await click(byText(m.el, 'Restore note'));
    await waitFor(() => !!m!.el.querySelector('[role=alert]'), 'explanation');
    expect(m.el.querySelector('[role=alert]')!.textContent).toMatch(/Restore the folder/);
    await click(byText(m.el, 'Open Trash'));
    expect(opened).toBe(1);
    const got = await client().call('notes.get', { id: n.id });
    expect(got.ok && got.value.trashed).toBe(true);
  });
});
