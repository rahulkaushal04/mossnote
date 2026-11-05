// @vitest-environment jsdom
// AT-1 .. AT-6, AT-10 (UI part). Real workspace + dispatcher + loopback; the preload's `native` is a fake.
// REAL timers (axe hangs under fake ones); the app under test uses manual timers.
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prefs } from '@mossnote/core/rpc';
import { bindCommands } from '../src/app/bindings';
import { createModel } from '../src/app/model';
import { AttachmentPreview } from '../src/attachments/AttachmentPreview';
import {
  AttachmentsPanel,
  type AttachmentsPanelProps,
  type PanelApi,
} from '../src/attachments/AttachmentsPanel';
import { CleanupDialog, LIMIT_MESSAGE, parseLimitMiB } from '../src/attachments/CleanupDialog';
import type { NativeBridge } from '../src/attachments/native';
import { DAMAGED_MESSAGE, MIB, verifySummary, type AttachmentRef } from '../src/attachments/types';
import { createRegistry } from '../src/commands/registry';
import { commands } from '../src/commands/manifest';
import { createClient } from '../src/rpc/client';
import { bootApp, noteOptions, runAxe, serious, text, typeInto, type Booted } from './helpers/app';
import { byText, click, mount, press, waitFor, type Mounted } from './helpers/dom';
import { manualTimers } from './helpers/timers';
import { makeEnv, type Env } from './helpers/workspace';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('payload-of-a-png-for-tests'),
]);

let env: Env;
let m: Mounted | undefined;
let b: Booted | undefined;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await m?.unmount();
  await b?.m.unmount();
  m = b = undefined;
  delete (window as { mossnote?: unknown }).mossnote;
  env.cleanup();
});

const client = () => createClient(env.bridge);
async function newNote(body = 'hello world'): Promise<string> {
  const r = await client().call('notes.create', { body });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.id;
}
async function attach(noteId: string, name: string, content: Uint8Array | string = PNG) {
  const r = await client().call('attachments.addPath', {
    noteId,
    token: env.upload(name, content),
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
async function listOf(noteId: string): Promise<AttachmentRef[]> {
  const r = await client().call('attachments.list', { noteId });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const rows = () => [...document.querySelectorAll<HTMLElement>('.att-list > li[data-ref]')];
const btn = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (x) => x.getAttribute('aria-label') === label || x.textContent?.trim() === label,
  );
const dialog = () => document.querySelector<HTMLElement>('[role=alertdialog]');

function fakeNative() {
  const queue: string[] = [];
  const contents: Record<string, Uint8Array | string> = {};
  const n = {
    pickFile: vi.fn(async () => queue.shift()),
    dropTokens: vi.fn(async (files: File[]) =>
      files.map((f) => env.upload(f.name, contents[f.name] ?? PNG)),
    ),
    pasteImage: vi.fn(async (noteId: string) => {
      const r = await client().call('attachments.addPath', {
        noteId,
        token: env.upload('pasted.png', PNG),
      });
      return r.ok ? { ok: true as const, value: r.value } : r;
    }),
    reveal: vi.fn(async () => undefined),
    saveCopy: vi.fn(async () => undefined),
    loadRemoteImage: vi.fn(),
  };
  return { n: n as unknown as NativeBridge & typeof n, queue, contents };
}

function panelEl(noteId: string, over: Partial<AttachmentsPanelProps> = {}) {
  const inserted: string[] = [];
  const el = (
    <AttachmentsPanel
      client={client()}
      noteId={noteId}
      readOnly={false}
      insert={(t) => (inserted.push(t), true)}
      {...over}
    />
  );
  return { el, inserted };
}
function dropEvent(type: 'drop' | 'dragover', files: File[]) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files } });
  return ev;
}

describe('adding files (AT-1)', () => {
  it('Add file: picker token -> attachments.addPath -> markdown inserted', async () => {
    const id = await newNote();
    const { n, queue } = fakeNative();
    queue.push(env.upload('pic.png', PNG));
    const { el, inserted } = panelEl(id, { native: n });
    m = await mount(el);
    await waitFor(() => /No attachments/.test(text()), 'empty state');
    await click(btn('Add file'));
    await waitFor(() => rows().length === 1, 'row');
    const [ref] = await listOf(id);
    expect(inserted).toEqual([ref!.markdown]);
    expect(ref!.markdown).toMatch(/^!\[.*\]\(mossnote-attachment:\/\/a\/[0-9a-f]{64}\)$/);
    expect(env.bridge.calls.find((c) => c.method === 'attachments.addPath')?.args).toMatchObject({
      noteId: id,
    });
  });

  it('a cancelled picker adds nothing', async () => {
    const id = await newNote();
    const { n } = fakeNative();
    const { el, inserted } = panelEl(id, { native: n });
    m = await mount(el);
    await waitFor(() => /No attachments/.test(text()));
    await click(btn('Add file'));
    await waitFor(() => n.pickFile.mock.calls.length === 1, 'picker');
    expect(env.bridge.count('attachments.addPath')).toBe(0);
    expect(inserted).toEqual([]);
  });

  it('drop on the panel: files -> dropTokens -> addPath; one markdown insert for several files', async () => {
    const id = await newNote();
    const { n } = fakeNative();
    const { el, inserted } = panelEl(id, { native: n });
    m = await mount(el);
    await waitFor(() => /No attachments/.test(text()));
    const files = [new File(['a'], 'one.png'), new File(['b'], 'two.png')];
    const ev = dropEvent('drop', files);
    await act(async () => void document.querySelector('.att-panel')!.dispatchEvent(ev));
    await waitFor(() => rows().length === 2, 'two rows');
    expect(ev.defaultPrevented).toBe(true);
    expect(n.dropTokens).toHaveBeenCalledWith(files);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.split('\n')).toHaveLength(2);
  });

  it('paste through the panel api calls native.pasteImage and inserts the markdown', async () => {
    const id = await newNote();
    const { n } = fakeNative();
    let api: PanelApi | null = null;
    const { el, inserted } = panelEl(id, { native: n, register: (a) => void (api = a) });
    m = await mount(el);
    await waitFor(() => api !== null, 'registered');
    await act(async () => api!.paste());
    await waitFor(() => rows().length === 1, 'row');
    expect(n.pasteImage).toHaveBeenCalledWith(id);
    expect(inserted).toHaveLength(1);
  });

  it('a paste with no image (null) changes nothing', async () => {
    const id = await newNote();
    const { n } = fakeNative();
    n.pasteImage.mockResolvedValueOnce({ ok: true, value: null } as never);
    let api: PanelApi | null = null;
    const { el, inserted } = panelEl(id, { native: n, register: (a) => void (api = a) });
    m = await mount(el);
    await waitFor(() => api !== null);
    await act(async () => api!.paste());
    await waitFor(() => n.pasteImage.mock.calls.length === 1);
    expect(inserted).toEqual([]);
    expect(rows()).toHaveLength(0);
  });

  it('core errors are shown as text and nothing is inserted', async () => {
    const id = await newNote();
    const { n, queue } = fakeNative();
    queue.push('tok-x');
    env.bridge.inject('attachments.addPath', {
      ok: false,
      error: { code: 'validation', message: 'That file is larger than the 200 MB limit.' },
    });
    const { el, inserted } = panelEl(id, { native: n });
    m = await mount(el);
    await waitFor(() => /No attachments/.test(text()));
    await click(btn('Add file'));
    await waitFor(() => !!document.querySelector('[role=alert]'), 'error');
    expect(document.querySelector('[role=alert]')!.textContent).toContain(
      'larger than the 200 MB limit',
    );
    expect(inserted).toEqual([]);
  });

  it('refreshes on a changed attachment event (an add from elsewhere)', async () => {
    const id = await newNote();
    const { el } = panelEl(id, { native: undefined });
    m = await mount(el);
    await waitFor(() => /No attachments/.test(text()));
    await attach(id, 'late.png');
    await waitFor(() => rows().length === 1, 'row after event');
  });
});

describe('native bridge absent', () => {
  it('hides Add file, Reveal and Save copy', async () => {
    const id = await newNote();
    await attach(id, 'a.png');
    const { el } = panelEl(id, { native: undefined });
    m = await mount(el);
    await waitFor(() => rows().length === 1);
    expect(btn('Add file')).toBeUndefined();
    expect(document.body.textContent).not.toMatch(/Reveal|Save copy/);
    expect(btn('Preview a.png')).toBeDefined();
  });
});

describe('read-only notes', () => {
  it('everything that changes the note is disabled, and a dropped file is consumed but not added', async () => {
    const id = await newNote();
    await attach(id, 'a.png');
    const { n } = fakeNative();
    let api: PanelApi | null = null;
    const { el, inserted } = panelEl(id, {
      native: n,
      readOnly: true,
      register: (a) => void (api = a),
    });
    m = await mount(el);
    await waitFor(() => rows().length === 1);
    expect(btn('Add file')!.disabled).toBe(true);
    expect(btn('Insert link to a.png')!.disabled).toBe(true);
    expect(btn('Remove a.png')!.disabled).toBe(true);
    expect(api!.canAttach()).toBe(false);
    const ev = dropEvent('drop', [new File(['x'], 'x.png')]);
    await act(async () => void document.querySelector('.att-panel')!.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(n.dropTokens).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
    expect(btn('Preview a.png')!.disabled).toBe(false);
  });
});

describe('remove', () => {
  it('asks first; Cancel keeps it, Remove deletes the reference', async () => {
    const id = await newNote();
    await attach(id, 'gone.png');
    const { el } = panelEl(id, { native: undefined });
    m = await mount(el);
    await waitFor(() => rows().length === 1);
    await click(btn('Remove gone.png'));
    expect(dialog()!.textContent).toContain('gone.png');
    await click(byText(dialog()!, 'Cancel'));
    expect(dialog()).toBeNull();
    expect(env.bridge.count('attachments.remove')).toBe(0);
    await click(btn('Remove gone.png'));
    await click(byText(dialog()!, 'Remove'));
    await waitFor(() => rows().length === 0, 'row removed');
    expect(await listOf(id)).toEqual([]);
  });
});

describe('untrusted names and contents are text only (AT-4)', () => {
  const NAMES = [
    '<img src=x onerror=alert(1)>.png',
    'evil‮txt.exe',
    'javascript:alert(1).txt',
    '"><script>alert(1)</script>.png',
  ];
  it('hostile file names render as text nodes: no element, no handler, no link', async () => {
    const id = await newNote();
    for (const n of NAMES) await attach(id, n);
    const { el } = panelEl(id, { native: fakeNative().n });
    m = await mount(el);
    await waitFor(() => rows().length === NAMES.length, 'rows');
    const refs = await listOf(id);
    const shown = rows().map((r) => r.querySelector('.att-name bdi')!.textContent);
    expect(shown.sort()).toEqual(refs.map((r) => r.name).sort());
    const list = document.querySelector('.att-list')!;
    expect(list.querySelector('img, script, a, iframe, [onerror], [href], [src]')).toBeNull();
    expect((window as { __xss?: unknown }).__xss).toBeUndefined();
  });

  it('a text attachment with markup in it is shown escaped via a text node', async () => {
    const id = await newNote();
    const body =
      'plain notes\n<img src=x onerror=alert(1)>\njavascript:alert(1)\n‮bidi <script>1</script>';
    const ref = await attach(id, 'note.txt', body);
    expect(ref.kind).toBe('text');
    const fetchText = vi.fn(async () => body);
    const { el } = panelEl(id, { native: undefined, fetchText });
    m = await mount(el);
    await waitFor(() => rows().length === 1);
    await click(btn('Preview note.txt'));
    await waitFor(() => !!document.querySelector('pre.att-text'), 'text preview');
    const pre = document.querySelector('pre.att-text')!;
    expect(pre.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(pre.children).toHaveLength(0);
    expect(document.querySelector('.att-list img, .att-list script')).toBeNull();
    expect(fetchText).toHaveBeenCalledWith(ref.url, expect.any(Number));
  });
});

const fake = (over: Partial<AttachmentRef>): AttachmentRef => ({
  refId: 'r1',
  noteId: 'n1',
  sha256: 'ab'.repeat(32),
  name: 'thing',
  size: 1234,
  mime: 'application/octet-stream',
  kind: 'other',
  textState: 'none',
  verifyState: 'ok',
  createdAt: 1,
  url: `mossnote-attachment://a/${'ab'.repeat(32)}`,
  markdown: '[thing](x)',
  ...over,
});

describe('previews', () => {
  const show = async (
    a: AttachmentRef,
    extra: { native?: NativeBridge; fetchText?: () => Promise<string> } = {},
  ) => {
    m = await mount(
      <AttachmentPreview
        attachment={a}
        client={client()}
        native={extra.native}
        {...(extra.fetchText ? { fetchText: extra.fetchText } : {})}
      />,
    );
  };
  const NEVER = 'iframe, object, embed, script, svg, canvas';

  it.each([['image'], ['svg']] as const)(
    '%s is an <img> on the attachment URL, never inline',
    async (kind) => {
      const a = fake({ kind, name: 'pic' });
      await show(a);
      const img = document.querySelector('img')!;
      expect(img.getAttribute('src')).toBe(a.url);
      expect(img.getAttribute('alt')).toBe('pic');
      expect(document.querySelector(NEVER)).toBeNull();
    },
  );
  it('audio and video use controls and the attachment URL', async () => {
    await show(fake({ kind: 'audio' }));
    expect(document.querySelector('audio[controls]')!.getAttribute('src')).toBe(fake({}).url);
    await m!.unmount();
    await show(fake({ kind: 'video' }));
    expect(document.querySelector('video[controls]')!.getAttribute('src')).toBe(fake({}).url);
    expect(document.querySelector(NEVER)).toBeNull();
  });
  it('pdf is a card with no embedded rendering', async () => {
    await show(fake({ kind: 'pdf', name: 'doc.pdf' }), { native: fakeNative().n });
    expect(document.body.textContent).toContain('PDF pages are not shown');
    expect(document.querySelector(`${NEVER}, img, [src]`)).toBeNull();
  });
  it('executable and other kinds are info cards only', async () => {
    await show(fake({ kind: 'executable', name: 'run.sh' }), { native: fakeNative().n });
    expect(document.body.textContent).toContain('never opened');
    expect(document.querySelector(`${NEVER}, img, a`)).toBeNull();
    await m!.unmount();
    await show(fake({ kind: 'html', name: 'page.html' }));
    expect(document.querySelector(`${NEVER}, img, a`)).toBeNull();
  });
  it('text preview without any reader says to use Save copy (the page never fetches)', async () => {
    await show(fake({ kind: 'text' }));
    expect(document.body.textContent).toContain('Use Save copy');
  });
  it('text preview failure is reported, not thrown', async () => {
    await show(fake({ kind: 'text' }), {
      fetchText: async () => Promise.reject(new Error('nope')),
    });
    await waitFor(() => /could not be previewed/.test(text()));
  });
  it('a broken image asks core to verify and shows its message', async () => {
    const msg = 'The file “pic” in note “Trip” is damaged. Restore it from a backup.';
    env.bridge.inject('attachments.info', {
      ok: true,
      value: {
        sha256: 'ab'.repeat(32),
        size: 1,
        mime: 'image/png',
        kind: 'image',
        textState: 'none',
        verifyState: 'corrupt',
        createdAt: 1,
        refs: [],
        state: 'corrupt',
        message: msg,
      },
    });
    const a = fake({ kind: 'image', name: 'pic' });
    await show(a);
    document.querySelector('img')!.dispatchEvent(new Event('error'));
    await waitFor(() => document.querySelector('[role=alert]')?.textContent === msg, 'message');
    expect(env.bridge.calls.find((c) => c.method === 'attachments.info')?.args).toEqual({
      sha256: a.sha256,
      noteId: a.noteId,
      verify: true,
    });
  });
});

describe('row actions', () => {
  it('Reveal and Save copy call native; executables get Reveal only', async () => {
    const id = await newNote();
    await attach(id, 'a.png');
    const { n } = fakeNative();
    const { el } = panelEl(id, { native: n });
    m = await mount(el);
    await waitFor(() => rows().length === 1);
    const [ref] = await listOf(id);
    await click(btn('Reveal a.png'));
    await click(btn('Save a copy of a.png'));
    expect(n.reveal).toHaveBeenCalledWith(ref!.sha256, id);
    expect(n.saveCopy).toHaveBeenCalledWith(ref!.sha256, id);

    await m.unmount();
    const exe = fake({ kind: 'executable', name: 'run.sh', noteId: id });
    env.bridge.inject('attachments.list', { ok: true, value: [exe] });
    m = await mount(panelEl(id, { native: n }).el);
    await waitFor(() => rows().length === 1);
    expect(btn('Reveal run.sh')).toBeDefined();
    expect(btn('Save a copy of run.sh')).toBeUndefined();
  });
  it('a native failure is shown', async () => {
    const id = await newNote();
    await attach(id, 'a.png');
    const { n } = fakeNative();
    n.reveal.mockResolvedValueOnce({
      ok: false,
      error: { code: 'io', message: 'Could not reveal.' },
    } as never);
    m = await mount(panelEl(id, { native: n }).el);
    await waitFor(() => rows().length === 1);
    await click(btn('Reveal a.png'));
    await waitFor(() => /Could not reveal/.test(text()));
  });
});

describe('states', () => {
  it('loading, then error with Retry', async () => {
    const id = await newNote();
    const hold = env.bridge.hold('attachments.list');
    m = await mount(panelEl(id, { native: undefined }).el);
    expect(text()).toContain('Loading attachments');
    await act(async () => hold.release());
    await waitFor(() => /No attachments/.test(text()));
    await m.unmount();
    env.bridge.inject('attachments.list', {
      ok: false,
      error: { code: 'io', message: 'disk on fire' },
    });
    m = await mount(panelEl(id, { native: undefined }).el);
    await waitFor(() => !!document.querySelector('[role=alert]'));
    expect(text()).toContain('disk on fire');
    await click(btn('Retry'));
    await waitFor(() => /No attachments/.test(text()), 'recovered');
  });

  it('missing/damaged rows show badges and the restore-from-backup message; pending/failed text badges', async () => {
    const id = await newNote();
    const base = fake({ noteId: id });
    env.bridge.inject('attachments.list', {
      ok: true,
      value: [
        { ...base, refId: 'a', name: 'lost.png', verifyState: 'missing' },
        { ...base, refId: 'b', name: 'bad.png', verifyState: 'corrupt' },
        { ...base, refId: 'c', name: 'x.pdf', kind: 'pdf', textState: 'pending' },
        { ...base, refId: 'd', name: 'y.pdf', kind: 'pdf', textState: 'failed' },
      ],
    });
    m = await mount(panelEl(id, { native: undefined }).el);
    await waitFor(() => rows().length === 4);
    const t = text();
    expect(t).toContain('Missing');
    expect(t).toContain('Damaged');
    expect(t).toContain('Text pending');
    expect(t).toContain('Text not extracted');
    expect(document.querySelectorAll('.att-bad-msg')).toHaveLength(2);
    expect(t).toContain(DAMAGED_MESSAGE);
  });

  it('500 attachments render quickly (smoke)', async () => {
    const id = await newNote();
    const many = Array.from({ length: 500 }, (_, i) =>
      fake({ refId: `r${i}`, noteId: id, name: `file-${i}.png`, kind: 'image' }),
    );
    env.bridge.inject('attachments.list', { ok: true, value: many });
    const t0 = performance.now();
    m = await mount(panelEl(id, { native: undefined }).el);
    await waitFor(() => rows().length === 500, 'all rows');
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(document.querySelectorAll('img')).toHaveLength(0); // previews are lazy
  });
});

describe('accessibility', () => {
  it('axe: 0 serious/critical for empty, list, error, loading and damaged states', async () => {
    const id = await newNote();
    await attach(id, 'a.png');
    const { n } = fakeNative();
    const found: Record<string, unknown> = {};
    const check = async (name: string) => {
      found[name] = serious(await runAxe());
    };
    m = await mount(panelEl(id, { native: n }).el);
    await waitFor(() => rows().length === 1);
    await click(btn('Preview a.png'));
    await check('list+preview');
    await m.unmount();

    const hold = env.bridge.hold('attachments.list');
    m = await mount(panelEl(id, { native: n }).el);
    await check('loading');
    await act(async () => hold.release());
    await waitFor(() => rows().length === 1);
    await m.unmount();

    env.bridge.inject('attachments.list', { ok: false, error: { code: 'io', message: 'boom' } });
    m = await mount(panelEl(id, { native: n }).el);
    await waitFor(() => !!document.querySelector('[role=alert]'));
    await check('error');
    await m.unmount();

    env.bridge.inject('attachments.list', {
      ok: true,
      value: [fake({ noteId: id, verifyState: 'corrupt' })],
    });
    m = await mount(panelEl(id, { native: n }).el);
    await waitFor(() => rows().length === 1);
    await check('damaged');
    await click(btn('Remove thing'));
    await check('confirm dialog');
    expect(found).toEqual({
      'list+preview': [],
      loading: [],
      error: [],
      damaged: [],
      'confirm dialog': [],
    });
  });

  it('keyboard: buttons are tabbable; Esc closes the confirm and returns focus to Remove', async () => {
    const id = await newNote();
    await attach(id, 'k.png');
    m = await mount(panelEl(id, { native: undefined }).el);
    await waitFor(() => rows().length === 1);
    const all = [...rows()[0]!.querySelectorAll('button')];
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.every((x) => x.tabIndex >= 0)).toBe(true);
    const remove = btn('Remove k.png')!;
    remove.focus();
    await click(remove);
    expect(document.activeElement?.textContent).toBe('Cancel');
    await press(dialog()!, 'Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(remove);
    const toggle = btn('Attachments (1)')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('in the editor (real CodeMirror)', () => {
  const view = () => EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
  async function openFirst(native: NativeBridge) {
    (window as unknown as { mossnote: unknown }).mossnote = { native };
    b = await bootApp(env, { editor: 'real' });
    await click(noteOptions()[0]);
    await waitFor(
      () =>
        !!document.querySelector('.cm-editor .cm-line') && !!document.querySelector('.att-panel'),
      'editor',
    );
  }
  const paste = (clip: object) => {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', {
      value: { getData: () => '', files: [], ...clip },
    });
    return ev;
  };

  it('inserts the markdown at the cursor', async () => {
    const id = await newNote('hello world');
    const { n, queue } = fakeNative();
    await openFirst(n);
    view().dispatch({ selection: { anchor: 5 } });
    queue.push(env.upload('pic.png', PNG));
    await click(btn('Add file'));
    await waitFor(() => view().state.doc.length > 11, 'inserted');
    const [ref] = await listOf(id);
    expect(view().state.doc.toString()).toBe(`hello${ref!.markdown} world`);
  });

  it('dropping a file on the editor adds it; image-only paste is intercepted, text paste is not', async () => {
    const id = await newNote('hello');
    const { n } = fakeNative();
    await openFirst(n);
    const content = document.querySelector('.cm-content')!;
    const drop = dropEvent('drop', [new File(['x'], 'd.png')]);
    await act(async () => void content.dispatchEvent(drop));
    await waitFor(() => view().state.doc.length > 5, 'dropped');
    expect(drop.defaultPrevented).toBe(true);
    expect(n.dropTokens).toHaveBeenCalledTimes(1);

    const imageOnly = paste({ types: ['Files'], items: [{ kind: 'file', type: 'image/png' }] });
    await act(async () => void content.dispatchEvent(imageOnly));
    await waitFor(() => n.pasteImage.mock.calls.length === 1, 'pasted');
    expect(n.pasteImage).toHaveBeenCalledWith(id);
    await waitFor(() => rows().length === 2, 'two attachments');

    const mixed = paste({
      types: ['text/plain', 'Files'],
      items: [{ kind: 'file', type: 'image/png' }],
    });
    await act(async () => void content.dispatchEvent(mixed));
    expect(n.pasteImage).toHaveBeenCalledTimes(1);
  });

  it('a trashed note opens read-only and the panel cannot change it', async () => {
    const id = await newNote('gone');
    await attach(id, 'a.png');
    await client().call('notes.trash', { id });
    const { n } = fakeNative();
    (window as unknown as { mossnote: unknown }).mossnote = { native: n };
    b = await bootApp(env, { editor: 'real', ready: () => true });
    b.model().openNote(id);
    await waitFor(() => rows().length === 1, 'panel');
    expect(btn('Add file')!.disabled).toBe(true);
    expect(btn('Remove a.png')!.disabled).toBe(true);
    expect(btn('Insert link to a.png')!.disabled).toBe(true);
  });
});

describe('cleanup (AT-6) and the size limit', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const preview = {
    items: [
      { sha256: A, size: 2 * MIB, mime: 'image/png', kind: 'image', untracked: false },
      { sha256: B, size: 1000, mime: '', kind: 'unknown', untracked: true },
    ],
    totalBytes: 2 * MIB + 1000,
  };
  const open = async (prefs?: Prefs, onPrefs: (p: Prefs) => void = () => {}) => {
    m = await mount(
      <CleanupDialog client={client()} prefs={prefs} onPrefs={onPrefs} onClose={() => {}} />,
    );
  };
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];

  it('lists items, needs a selection, confirms with count and bytes, then runs and reports skipped', async () => {
    env.bridge.inject('attachments.cleanupPreview', { ok: true, value: preview }, 10);
    env.bridge.inject('attachments.cleanupRun', {
      ok: true,
      value: { deleted: 1, bytes: 2 * MIB, skipped: [B] },
    });
    await open();
    await waitFor(() => boxes().length === 2, 'items');
    const del = () =>
      [...document.querySelectorAll('button')].find((x) => x.textContent?.startsWith('Delete '))!;
    expect(del().disabled).toBe(true);
    await click(boxes()[0]);
    await click(del());
    expect(dialog()!.textContent).toContain('Delete 1 unused file(s)?');
    expect(dialog()!.textContent).toContain('2.0 MB');
    expect(env.bridge.count('attachments.cleanupRun')).toBe(0);
    await click(byText(dialog()!, 'Delete 1 file(s)'));
    await waitFor(() => /Deleted 1 file/.test(text()), 'result');
    expect(env.bridge.calls.find((c) => c.method === 'attachments.cleanupRun')?.args).toEqual({
      sha256s: [A],
      confirmed: true,
    });
    expect(text()).toContain('1 skipped');
  });

  it('Cancel in the confirmation deletes nothing', async () => {
    env.bridge.inject('attachments.cleanupPreview', { ok: true, value: preview }, 10);
    await open();
    await waitFor(() => boxes().length === 2);
    await click(boxes()[1]);
    await click(
      [...document.querySelectorAll('button')].find((x) => x.textContent?.startsWith('Delete '))!,
    );
    await click(byText(dialog()!, 'Cancel'));
    expect(env.bridge.count('attachments.cleanupRun')).toBe(0);
    await waitFor(() => boxes().length === 2, 'list back');
  });

  it('shows empty and error states (Retry recovers)', async () => {
    env.bridge.inject('attachments.cleanupPreview', {
      ok: false,
      error: { code: 'io', message: 'scan failed' },
    });
    await open();
    await waitFor(() => /scan failed/.test(text()));
    await click(btn('Retry'));
    await waitFor(() => /No unused attachments/.test(text()), 'empty');
  });

  it('validates the size limit (1 MiB .. 1 GiB) and saves a valid one', async () => {
    const p = await client().call('prefs.get');
    if (!p.ok) throw new Error('prefs');
    const saved: Prefs[] = [];
    await open(p.value, (x) => void saved.push(x));
    await waitFor(() => /No unused attachments/.test(text()));
    const input = document.querySelector<HTMLInputElement>('.att-sizes input')!;
    expect(input.value).toBe('200');
    for (const bad of ['0', '1025', '1.5', 'abc', '']) {
      await typeInto(input, bad);
      await click(btn('Save limit'));
      expect(document.querySelector('.att-sizes [role=alert]')?.textContent).toBe(LIMIT_MESSAGE);
    }
    expect(env.bridge.count('prefs.set')).toBe(0);
    await typeInto(input, '300');
    await click(btn('Save limit'));
    await waitFor(() => saved.length === 1, 'saved');
    expect(saved[0]!.attachmentMaxBytes).toBe(300 * MIB);
    expect(env.bridge.calls.find((c) => c.method === 'prefs.set')?.args).toEqual({
      attachmentMaxBytes: 300 * MIB,
    });
  });

  it('parseLimitMiB bounds', () => {
    expect(parseLimitMiB('1')).toBe(MIB);
    expect(parseLimitMiB(' 1024 ')).toBe(1024 * MIB);
    expect(parseLimitMiB('0')).toBeUndefined();
    expect(parseLimitMiB('1025')).toBeUndefined();
    expect(parseLimitMiB('-5')).toBeUndefined();
  });

  it('axe on the cleanup dialog', async () => {
    env.bridge.inject('attachments.cleanupPreview', { ok: true, value: preview }, 10);
    await open();
    await waitFor(() => boxes().length === 2);
    expect(serious(await runAxe())).toEqual([]);
  });
});

describe('commands', () => {
  it('are in the manifest without shortcuts (no clash possible)', () => {
    const mine = commands.filter((c) => c.id.startsWith('attachments.'));
    expect(mine.map((c) => c.id).sort()).toEqual([
      'attachments.add',
      'attachments.cleanup',
      'attachments.verify',
    ]);
    expect(mine.every((c) => !c.shortcut)).toBe(true);
  });

  it('verify toasts the report, cleanup opens the dialog, add needs an editable open note', async () => {
    const model = createModel({ bridge: env.bridge, timers: manualTimers() });
    const reg = createRegistry();
    let opened = 0;
    const off = bindCommands(reg, model, {
      tree: () => null,
      togglePalette() {},
      toggleShortcuts() {},
      toggleNav() {},
      openCleanup: () => void opened++,
    });
    expect(reg.run('attachments.cleanup')).toBe(true);
    expect(opened).toBe(1);
    expect(reg.run('attachments.add')).toBe(false);
    const pick = vi.fn();
    model.hooks.attach = { canAttach: () => true, pick, drop() {}, paste() {} };
    expect(reg.run('attachments.add')).toBe(true);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(reg.run('attachments.verify')).toBe(true);
    await waitFor(() => model.toasts.get().toasts.length === 1, 'toast');
    expect(model.toasts.get().toasts[0]!.message).toMatch(/^Checked 0 attachment/);
    off();
    model.dispose();
  });

  it('verifySummary names the damage and the remedy', () => {
    const f = { sha256: 'a', size: 1, notes: [] };
    expect(verifySummary({ checked: 3, ok: 3, missing: [], corrupt: [], untracked: [] })).toBe(
      'Checked 3 attachment(s): all are intact.',
    );
    const s = verifySummary({ checked: 4, ok: 1, missing: [f], corrupt: [f, f], untracked: ['x'] });
    expect(s).toContain('1 missing, 2 damaged');
    expect(s).toContain('backup');
    expect(s).toContain('1 unused');
  });
});
