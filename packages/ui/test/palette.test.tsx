// @vitest-environment jsdom
import { act, useEffect, useMemo, useRef, useState } from 'react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { NoteSummary } from '@mossnote/core/rpc';
import { commands as manifest } from '../src/commands/manifest';
import { createRegistry, useGlobalShortcuts, type Registry } from '../src/commands/registry';
import { createEditor, type EditorHandle } from '../src/editor/createEditor';
import { Palette } from '../src/palette/Palette';
import { formatShortcut } from '../src/shortcuts/keys';
import { mount, press, settle, type Mounted } from './helpers/dom';
import { makeEnv, type Env } from './helpers/workspace';

let env: Env | undefined;
let m: Mounted | undefined;
afterEach(async () => {
  await m?.unmount();
  env?.cleanup();
  m = env = undefined;
});

const dialog = () => document.querySelector<HTMLElement>('[role=dialog]');
const input = () => document.querySelector<HTMLInputElement>('input[role=combobox]')!;
const options = () => [...document.querySelectorAll<HTMLElement>('[role=option]')];
const labels = () => options().map((o) => o.querySelector('span')!.textContent);
const activeLabel = () =>
  document.getElementById(input().getAttribute('aria-activedescendant')!)!.querySelector('span')!
    .textContent;
const ctrlK = { ctrlKey: true };

async function typeInto(el: HTMLInputElement, v: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

interface Calls {
  opened: string[];
  created: string[];
  ran: string[];
  retried: number;
}
let editor: EditorHandle | undefined;
let focusModeExits: number;

/** The shell stand-in S8 will replace: a registry, the global hook, an opener, a real editor. */
function Harness(props: {
  notes: readonly { id: string; title: string }[] | undefined;
  calls: Calls;
  notesError?: string;
  registryRef?: (r: Registry) => void;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const registry = useMemo(() => createRegistry(), []);
  useEffect(() => {
    props.registryRef?.(registry);
    const offs = [
      registry.bind('view.palette', () => setOpen((o) => !o)),
      registry.bind('note.new', () => props.calls.ran.push('note.new')),
      registry.bind('format.bold', () => props.calls.ran.push('format.bold')),
      registry.bind('view.shortcuts', () => props.calls.ran.push('view.shortcuts')),
    ];
    return () => offs.forEach((o) => o());
  }, [registry, props]);
  useGlobalShortcuts(registry, { platform: 'other' });
  useEffect(() => {
    // Esc handler of "focus mode": lowest priority, only acts if nothing above consumed the event.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) focusModeExits++;
    };
    window.addEventListener('keydown', onEsc);
    editor = createEditor(host.current!, { doc: 'hello' });
    return () => {
      window.removeEventListener('keydown', onEsc);
      editor?.destroy();
    };
  }, []);
  return (
    <>
      <button id="opener">opener</button>
      <div ref={host} />
      {open && (
        <Palette
          commands={registry.list()}
          notes={props.notes}
          notesError={props.notesError}
          onRetryNotes={() => props.calls.retried++}
          platform="other"
          onRunCommand={(id) => props.calls.ran.push(id)}
          onOpenNote={(id) => props.calls.opened.push(id)}
          onCreateNote={(t) => props.calls.created.push(t)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
const newCalls = (): Calls => ({ opened: [], created: [], ran: [], retried: 0 });
const contentDom = () => editor!.view.contentDOM;

async function realNotes(titles: string[]): Promise<NoteSummary[]> {
  env = makeEnv();
  for (const t of titles) {
    const r = await env.bridge.rpc('notes.create', { body: `# ${t}\n` });
    if (!r.ok) throw new Error(r.error.message);
  }
  const l = await env.bridge.rpc('notes.list', { limit: 100 });
  if (!l.ok) throw new Error(l.error.message);
  return l.value as NoteSummary[];
}
async function openFromEditor(): Promise<void> {
  contentDom().focus();
  await press(contentDom(), 'k', ctrlK);
}

describe('opening and closing', () => {
  it('Mod-K inside a real CodeMirror editor opens the palette; CodeMirror never sees it', async () => {
    focusModeExits = 0;
    m = await mount(<Harness notes={[]} calls={newCalls()} />);
    const before = editor!.getText();
    contentDom().focus();
    expect(document.activeElement).toBe(contentDom());
    // An editor keymap that swallows keys must not be able to hide Mod-K: only the capture phase beats it.
    contentDom().addEventListener('keydown', (e) => e.stopPropagation());
    const ev = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => void contentDom().dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(input());
    expect(editor!.getText()).toBe(before);
  });
  it('Mod-K again closes and focus returns to the opener (the editor)', async () => {
    m = await mount(<Harness notes={[]} calls={newCalls()} />);
    await openFromEditor();
    expect(dialog()).not.toBeNull();
    await press(input(), 'k', ctrlK);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(contentDom());
  });
  it('Esc closes, returns focus to a button opener, and is consumed before the focus-mode handler', async () => {
    focusModeExits = 0;
    m = await mount(<Harness notes={[]} calls={newCalls()} />);
    const opener = document.getElementById('opener')!;
    opener.focus();
    await press(opener, 'k', ctrlK);
    await press(input(), 'Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(focusModeExits).toBe(0); // palette > focus mode
    await press(opener, 'Escape');
    expect(focusModeExits).toBe(1); // with nothing above it, focus mode gets Esc
  });
  it('an open alertdialog blocks Mod-K (dialog > palette)', async () => {
    m = await mount(<Harness notes={[]} calls={newCalls()} />);
    const a = document.createElement('div');
    a.setAttribute('role', 'alertdialog');
    document.body.append(a);
    await openFromEditor();
    a.remove();
    expect(dialog()).toBeNull();
  });
  it('focus is trapped: Tab stays inside and outside focus is pulled back', async () => {
    m = await mount(<Harness notes={[]} calls={newCalls()} />);
    await openFromEditor();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => void input().dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    await act(async () => document.getElementById('opener')!.focus());
    expect(document.activeElement).toBe(input());
  });
});

describe('global shortcuts', () => {
  it('runs non-format commands inside the editor, leaves format.* to the editor keymap, ignores modals', async () => {
    const calls = newCalls();
    m = await mount(<Harness notes={[]} calls={calls} />);
    contentDom().focus();
    await press(contentDom(), 'n', ctrlK);
    expect(calls.ran).toEqual(['note.new']);
    await press(contentDom(), 'b', ctrlK); // CodeMirror's formatting keymap handles this one
    expect(calls.ran).toEqual(['note.new']);
    expect(editor!.getText()).toBe('****hello'); // the editor's own keymap applied bold
    await press(document.getElementById('opener')!, 'F1');
    expect(calls.ran).toEqual(['note.new', 'view.shortcuts']);
    await openFromEditor();
    await press(input(), 'n', ctrlK); // a modal is open: only Mod-K gets through
    expect(calls.ran).toEqual(['note.new', 'view.shortcuts']);
  });
});

describe('results', () => {
  it('lists enabled commands with shortcut text and notes from a real workspace', async () => {
    const notes = await realNotes(['Groceries', 'Meeting minutes']);
    m = await mount(<Harness notes={notes} calls={newCalls()} />);
    await openFromEditor();
    const l = labels();
    expect(l).toEqual(
      expect.arrayContaining([
        'Command palette',
        'New note',
        'Bold',
        'Groceries',
        'Meeting minutes',
      ]),
    );
    expect(l).not.toContain('Toggle favorite'); // not bound, so not enabled
    const row = options().find((o) => o.textContent!.startsWith('New note'))!;
    expect(row.querySelector('kbd')!.textContent).toBe(formatShortcut('Mod-N', 'other'));
    expect(options().every((o) => o.id)).toBe(true);
  });
  it('fuzzy-ranks commands and notes together; Enter opens the active note', async () => {
    const notes = await realNotes(['Boldly going', 'Zebra']);
    const calls = newCalls();
    m = await mount(<Harness notes={notes} calls={calls} />);
    await openFromEditor();
    await typeInto(input(), 'bold');
    expect(labels().slice(0, 2)).toEqual(['Bold', 'Boldly going']);
    expect(labels()).not.toContain('Zebra');
    await press(input(), 'ArrowDown');
    expect(activeLabel()).toBe('Boldly going');
    await press(input(), 'Enter');
    expect(calls.opened).toEqual([notes.find((n) => n.title === 'Boldly going')!.id]);
    expect(dialog()).toBeNull();
  });
  it('Enter on a command closes first, then runs it', async () => {
    const calls = newCalls();
    m = await mount(<Harness notes={[]} calls={calls} />);
    await openFromEditor();
    await typeInto(input(), 'new note');
    await press(input(), 'Enter');
    expect(calls.ran).toEqual(['note.new']);
    expect(dialog()).toBeNull();
  });
  it('Up/Down/Home/End move the active option and aria-activedescendant follows', async () => {
    m = await mount(<Harness notes={[{ id: 'a', title: 'Alpha' }]} calls={newCalls()} />);
    await openFromEditor();
    const n = options().length;
    const sel = () => options().findIndex((o) => o.getAttribute('aria-selected') === 'true');
    expect(sel()).toBe(0);
    await press(input(), 'ArrowDown');
    expect(sel()).toBe(1);
    await press(input(), 'End');
    expect(sel()).toBe(n - 1);
    await press(input(), 'ArrowDown');
    expect(sel()).toBe(n - 1);
    await press(input(), 'Home');
    expect(sel()).toBe(0);
    await press(input(), 'ArrowUp');
    expect(sel()).toBe(0);
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
  });
  it('no matches shows the message and a Create note row that creates with the query', async () => {
    const calls = newCalls();
    m = await mount(<Harness notes={[]} calls={calls} />);
    await openFromEditor();
    await typeInto(input(), 'qqzz');
    expect(document.querySelector('[role=status]')!.textContent).toBe('No matches');
    expect(labels()).toEqual(['Create note “qqzz”']);
    await press(input(), 'Enter');
    expect(calls.created).toEqual(['qqzz']);
  });
  it('shows loading and error states, still lists commands, and Retry works', async () => {
    const calls = newCalls();
    m = await mount(<Harness notes={undefined} calls={calls} />);
    await openFromEditor();
    expect(document.querySelector('[role=status]')!.textContent).toContain('Loading notes…');
    expect(labels()).toContain('New note');
    await m.unmount();
    m = await mount(<Harness notes={undefined} notesError="disk gone" calls={calls} />);
    await openFromEditor();
    expect(document.querySelector('[role=status]')!.textContent).toContain('disk gone');
    const retry = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!;
    await act(async () => retry.click());
    expect(calls.retried).toBe(1);
  });
  it('10k notes: filtering is fast and the DOM stays capped', async () => {
    const notes = Array.from({ length: 10_000 }, (_, i) => ({
      id: `n${i}`,
      title: `Note number ${i} about topic ${i % 97}`,
    }));
    m = await mount(<Harness notes={notes} calls={newCalls()} />);
    const t0 = performance.now();
    await openFromEditor();
    const open = performance.now() - t0;
    expect(options().length).toBeLessThanOrEqual(51);
    const t1 = performance.now();
    await typeInto(input(), 'topic 42');
    const typed = performance.now() - t1;
    expect(options().length).toBeLessThanOrEqual(51);
    expect(labels()[0]).toMatch(/topic 42/);
    expect(open).toBeLessThan(500);
    expect(typed).toBeLessThan(500);
  });
});

describe('a11y', () => {
  it('has no serious or critical axe violations with results, empty and error states', async () => {
    m = await mount(
      <Harness notes={[{ id: 'a', title: 'Alpha' }]} calls={newCalls()} notesError="x" />,
    );
    await openFromEditor();
    const bad = async () =>
      (
        await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })
      ).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect((await bad()).map((v) => v.id)).toEqual([]);
    await typeInto(input(), 'qqzz');
    expect((await bad()).map((v) => v.id)).toEqual([]);
    await settle();
    expect(manifest.length).toBeGreaterThan(0);
  });
});
