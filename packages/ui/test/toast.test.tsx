// @vitest-environment jsdom
import { act } from 'react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderTree } from '../src/nav/FolderTree';
import { createNavStore } from '../src/nav/navStore';
import { createClient } from '../src/rpc/client';
import { Toasts } from '../src/toast/Toasts';
import { createToastStore } from '../src/toast/toastStore';
import { createTrashActions } from '../src/trash/trashActions';
import { byText, mount, type Mounted } from './helpers/dom';
import { makeEnv, type Env } from './helpers/workspace';

let env: Env;
let m: Mounted | undefined;
beforeEach(() => {
  env = makeEnv();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(async () => {
  await m?.unmount();
  m = undefined;
  vi.useRealTimers();
  env.cleanup();
});

/** Advances fake time inside act, letting promises (the loopback is promise-only) settle. */
const adv = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const fire = (
  el: Element,
  type: string,
  E: new (type: string, init?: EventInit) => Event = MouseEvent,
) => act(async () => void el.dispatchEvent(new E(type, { bubbles: true })));
const clickEl = (el: Element | null | undefined) =>
  act(async () => void (el as HTMLElement).click());

const setup = () => {
  const client = createClient(env.bridge);
  const toasts = createToastStore();
  const actions = createTrashActions({ client, toasts });
  return { client, toasts, actions };
};
const note = async (body: string, folderId: string | null = null) => {
  const r = await createClient(env.bridge).call('notes.create', { body, folderId });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const folder = async (name: string, parentId: string | null = null) => {
  const r = await createClient(env.bridge).call('folders.create', { name, parentId });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const live = async (trashed = false) => {
  const r = await createClient(env.bridge).call('notes.list', trashed ? { trashed: true } : {});
  return r.ok ? r.value.map((n) => n.title) : [];
};
const undoBtn = () => byText(document.body, 'Undo delete');

describe('delete + toast + undo', () => {
  it('deleteNote moves the note to Trash and shows a named toast with Undo', async () => {
    const { toasts, actions } = setup();
    m = await mount(<Toasts store={toasts} />);
    const n = await note('Groceries\nmilk');
    expect(await live()).toEqual(['Groceries']);
    const r = await act(async () => actions.deleteNote(n.id));
    expect(r.ok).toBe(true);
    expect(await live()).toEqual([]);
    expect(await live(true)).toEqual(['Groceries']);
    const region = m.el.querySelector('[role=status]')!;
    expect(region.textContent).toContain('Moved "Groceries" to Trash.');
    expect(undoBtn()).toBeTruthy();
  });

  it('Undo within 10 s restores the note', async () => {
    const { toasts, actions } = setup();
    m = await mount(<Toasts store={toasts} />);
    const n = await note('Groceries');
    await act(async () => void (await actions.deleteNote(n.id)));
    await adv(9_000);
    expect(undoBtn()).toBeTruthy();
    await clickEl(undoBtn());
    await adv(0);
    expect(await live()).toEqual(['Groceries']);
    expect(await live(true)).toEqual([]);
    expect(undoBtn()).toBeUndefined();
    expect(m.el.textContent).toContain('Restored "Groceries".');
    expect(env.bridge.calls.find((c) => c.method === 'trash.restore')?.args).toEqual({
      batchId: expect.any(String),
    });
  });

  it('Undo restores a folder with its nested folders and notes', async () => {
    const { toasts, actions } = setup();
    m = await mount(<Toasts store={toasts} />);
    const top = await folder('Top');
    const sub = await folder('Sub', top.id);
    await note('in top', top.id);
    await note('in sub', sub.id);
    await act(async () => void (await actions.deleteFolder(top.id)));
    const gone = await createClient(env.bridge).call('folders.list');
    expect(gone.ok && gone.value).toEqual([]);
    expect(await live()).toEqual([]);
    expect(m.el.textContent).toContain('Moved "Top" to Trash.');
    await clickEl(undoBtn());
    await adv(0);
    const back = await createClient(env.bridge).call('folders.list');
    expect(back.ok && back.value.map((f) => f.name).sort()).toEqual(['Sub', 'Top']);
    expect((await live()).sort()).toEqual(['in sub', 'in top']);
  });

  it('the toast and its Undo are gone after 10 s; the note stays in Trash', async () => {
    const { toasts, actions } = setup();
    m = await mount(<Toasts store={toasts} />);
    const n = await note('Groceries');
    await act(async () => void (await actions.deleteNote(n.id)));
    await adv(9_999);
    expect(undoBtn()).toBeTruthy();
    await adv(1);
    expect(undoBtn()).toBeUndefined();
    expect(m.el.querySelector('.toast')).toBeNull();
    expect(await live(true)).toEqual(['Groceries']);
  });

  it('hover pauses the countdown and leaving resumes with the time that was left', async () => {
    const { toasts, actions } = setup();
    m = await mount(<Toasts store={toasts} />);
    const n = await note('Groceries');
    await act(async () => void (await actions.deleteNote(n.id)));
    await adv(6_000);
    const t = m.el.querySelector('.toast')!;
    await fire(t, 'mouseover');
    await adv(60_000);
    expect(undoBtn()).toBeTruthy();
    await fire(t, 'mouseout');
    await adv(3_999);
    expect(undoBtn()).toBeTruthy();
    await adv(1);
    expect(undoBtn()).toBeUndefined();
  });

  it('keyboard focus pauses too, and it needs both hover and focus released to resume', async () => {
    const { toasts, actions } = setup();
    m = await mount(<Toasts store={toasts} />);
    const n = await note('Groceries');
    await act(async () => void (await actions.deleteNote(n.id)));
    const t = m.el.querySelector('.toast')!;
    await fire(t, 'focusin', FocusEvent);
    await fire(t, 'mouseover');
    await adv(30_000);
    expect(undoBtn()).toBeTruthy();
    await fire(t, 'mouseout');
    await adv(30_000);
    expect(undoBtn()).toBeTruthy(); // still focused
    await fire(t, 'focusout', FocusEvent);
    await adv(10_000);
    expect(undoBtn()).toBeUndefined();
  });

  it('stacks toasts; Undo restores the one it belongs to, undoLatest the newest', async () => {
    const { toasts, actions } = setup();
    m = await mount(<Toasts store={toasts} />);
    const a = await note('Alpha');
    const b = await note('Beta');
    await act(async () => void (await actions.deleteNote(a.id)));
    await adv(2_000);
    await act(async () => void (await actions.deleteNote(b.id)));
    expect(m.el.querySelectorAll('.toast')).toHaveLength(2);
    await adv(8_000); // the first one has now lived 10 s, the second 8 s
    expect(m.el.querySelectorAll('.toast')).toHaveLength(1);
    expect(m.el.textContent).toContain('"Beta"');
    expect(await act(async () => toasts.undoLatest())).toBe(true);
    await adv(0);
    expect(await live()).toEqual(['Beta']);
    expect(await act(async () => toasts.undoLatest())).toBe(false);
  });

  it('Undo after the item was purged says so instead of failing silently', async () => {
    const { toasts, actions } = setup();
    m = await mount(<Toasts store={toasts} />);
    const n = await note('Groceries');
    const r = await act(async () => actions.deleteNote(n.id));
    if (!r.ok) throw new Error('delete');
    await createClient(env.bridge).call('trash.purge', { batchId: r.batchId, confirmed: true });
    await clickEl(undoBtn());
    await adv(0);
    expect(m.el.textContent).toContain('"Groceries" was already deleted permanently.');
    expect(await live()).toEqual([]);
  });

  it('a failed delete reports the reason and offers no Undo', async () => {
    const { toasts, actions } = setup();
    m = await mount(<Toasts store={toasts} />);
    const r = await act(async () => actions.deleteNote('does-not-exist'));
    expect(r.ok).toBe(false);
    expect(undoBtn()).toBeUndefined();
    expect(m.el.textContent).toMatch(/Couldn’t move to Trash/);
  });

  it('beforeTrash runs first (flush) and onTrashed/onRestored are reported', async () => {
    const client = createClient(env.bridge);
    const toasts = createToastStore();
    const order: string[] = [];
    const actions = createTrashActions({
      client,
      toasts,
      beforeTrash: async () => void order.push('flush'),
      onTrashed: (e, id) => void order.push(`trashed:${e}:${id.length > 0}`),
      onRestored: (e) => void order.push(`restored:${e}`),
    });
    m = await mount(<Toasts store={toasts} />);
    const n = await note('x');
    await act(async () => void (await actions.deleteNote(n.id)));
    await clickEl(undoBtn());
    await adv(0);
    expect(order).toEqual(['flush', 'trashed:note:true', 'restored:note']);
  });

  it('lists refresh from the changed events: the tree drops the folder and counts Trash', async () => {
    const { client, toasts, actions } = setup();
    const nav = createNavStore();
    const f = await folder('Gone');
    m = await mount(
      <>
        <FolderTree client={client} nav={nav} actions={actions} />
        <Toasts store={toasts} />
      </>,
    );
    await adv(0);
    expect(m.el.textContent).toContain('Gone');
    await act(async () => void (await actions.deleteFolder(f.id)));
    await adv(0);
    expect(m.el.querySelector('[role=tree]')!.textContent).not.toContain('Gone');
    expect(m.el.querySelector('[role=tree]')!.textContent).toContain('Trash (1)');
    await clickEl(undoBtn());
    await adv(0);
    expect(m.el.querySelector('[role=tree]')!.textContent).toContain('Gone');
    expect(m.el.querySelector('[role=tree]')!.textContent).toContain('Trash (0)');
  });

  it('is a status region, Undo is a keyboard-reachable button, and axe is clean', async () => {
    const { toasts, actions } = setup();
    m = await mount(<Toasts store={toasts} />);
    expect(m.el.querySelector('[role=status]')).toBeTruthy(); // present even when empty
    const n = await note('Groceries');
    await act(async () => void (await actions.deleteNote(n.id)));
    const u = undoBtn()!;
    expect(u.tagName).toBe('BUTTON');
    expect(u.tabIndex).toBe(0);
    vi.useRealTimers(); // axe schedules with setTimeout
    const r = await axe.run(m.el, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    await clickEl(byText(m.el, 'Dismiss'));
    expect(m.el.querySelector('.toast')).toBeNull();
  });
});
