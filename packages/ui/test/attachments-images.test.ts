// @vitest-environment jsdom
// AT-10 / AT-5 (editor part): which URLs may reach an <img>, the remote "Load image" flow, eq().
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorHandle } from '../src/editor/createEditor';
import { ImageWidget, INERT_IMAGE_TEXT, MISSING_ATTACHMENT_TEXT } from '../src/editor/images';
import type { NativeBridge } from '../src/attachments/native';

const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
Range.prototype.getClientRects ??= noRects as never;
Range.prototype.getBoundingClientRect ??= (() => new DOMRect()) as never;

const SHA = 'ab'.repeat(32);
const ATT = `mossnote-attachment://a/${SHA}`;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

let hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.forEach((h) => h.remove());
  hosts = [];
  delete (window as { mossnote?: unknown }).mossnote;
  vi.restoreAllMocks();
});
function mount(doc: string): EditorHandle {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  return createEditor(host, { doc });
}
const imgs = (ed: EditorHandle) => [
  ...ed.view.contentDOM.querySelectorAll<HTMLImageElement>('img:not(.cm-widgetBuffer)'),
];
const inert = (ed: EditorHandle) => ed.view.contentDOM.querySelectorAll('.cm-image-inert');
const later = () => new Promise<void>((r) => setTimeout(r, 0));
function installNative(n: Partial<NativeBridge>) {
  (window as unknown as { mossnote: unknown }).mossnote = { native: n };
}

describe('image URL matrix', () => {
  it('renders data: and the exact attachment URL, with alt text', () => {
    const ed = mount(`![a pic](${PNG})\n\n![doc](${ATT})`);
    const got = imgs(ed);
    expect(got.map((i) => i.getAttribute('src'))).toEqual([PNG, ATT]);
    expect(got.map((i) => i.getAttribute('alt'))).toEqual(['a pic', 'doc']);
  });

  const BLOCKED = [
    `mossnote-attachment://a/${SHA.toUpperCase()}`,
    `mossnote-attachment://a/${SHA.slice(1)}`,
    `mossnote-attachment://a/${SHA}0`,
    `mossnote-attachment://a/${SHA}/x`,
    `mossnote-attachment://a/${SHA}?x=1`,
    `mossnote-attachment://b/${SHA}`,
    `mossnote-attachment:a/${SHA}`,
    `mossnote-attachment://evil/${SHA}`,
    'javascript:alert(1)',
    'file:///etc/passwd',
    'blob:null/abc',
    'http://evil.example/a.png',
    'https://evil.example/a.png',
    'data:text/html,hello',
  ];
  it.each(BLOCKED)('keeps %s inert and never sets a src', (url) => {
    const srcs: string[] = [];
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get: desc.get,
      set(v: string) {
        srcs.push(v);
      },
    });
    try {
      const ed = mount(`![x](${url})`);
      expect(imgs(ed)).toHaveLength(0);
      expect(inert(ed)).toHaveLength(1);
      expect(inert(ed)[0]!.textContent).toBe(INERT_IMAGE_TEXT);
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, 'src', desc);
    }
    expect(srcs).toEqual([]);
  });

  it('rebuilds the image when only the hash inside the URL changes (eq compares the URL)', () => {
    const ed = mount(`![x](${ATT})`);
    expect(imgs(ed)[0]!.getAttribute('src')).toBe(ATT);
    const at = ed.getText().indexOf(SHA);
    ed.view.dispatch({ changes: { from: at, to: at + 1, insert: 'c' } });
    expect(imgs(ed)[0]!.getAttribute('src')).toBe(`mossnote-attachment://a/c${SHA.slice(1)}`);
  });

  it('eq compares alt, range length and the URL key', () => {
    const w = (alt: string, to: number, key: string) => new ImageWidget(alt, 0, to, key);
    expect(w('a', 10, 'k').eq(w('a', 10, 'k'))).toBe(true);
    expect(w('a', 10, 'k').eq(w('a', 10, 'j'))).toBe(false);
    expect(w('a', 10, 'k').eq(w('b', 10, 'k'))).toBe(false);
    expect(w('a', 10, 'k').eq(w('a', 11, 'k'))).toBe(false);
  });

  it('a failing attachment image is replaced by the missing/damaged message', () => {
    const ed = mount(`![x](${ATT})`);
    imgs(ed)[0]!.dispatchEvent(new Event('error'));
    expect(imgs(ed)).toHaveLength(0);
    expect(inert(ed)[0]!.textContent).toBe(MISSING_ATTACHMENT_TEXT);
  });
});

describe('remote images (AT-10)', () => {
  const URL_ = 'https://img.example/a.png';
  it('shows no button without the native bridge and makes no request', () => {
    const ed = mount(`![x](${URL_})`);
    expect(ed.view.contentDOM.querySelector('button')).toBeNull();
    expect(inert(ed)).toHaveLength(1);
  });

  it('Load image asks main, then shows the returned data: URL', async () => {
    const load = vi.fn(async () => ({ ok: true as const, value: { dataUrl: PNG } }));
    installNative({ loadRemoteImage: load });
    const ed = mount(`![x](${URL_})`);
    const btn = ed.view.contentDOM.querySelector<HTMLButtonElement>('.cm-image-remote button')!;
    expect(btn.textContent).toBe('Load image');
    expect(imgs(ed)).toHaveLength(0);
    btn.click();
    await later();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(URL_);
    expect(imgs(ed).map((i) => i.getAttribute('src'))).toEqual([PNG]);
  });

  it('shows the refusal from main and no image', async () => {
    installNative({
      loadRemoteImage: async () => ({
        ok: false,
        error: { code: 'validation', message: 'Not allowed' },
      }),
    });
    const ed = mount(`![x](${URL_})`);
    ed.view.contentDOM.querySelector<HTMLButtonElement>('.cm-image-remote button')!.click();
    await later();
    expect(imgs(ed)).toHaveLength(0);
    expect(inert(ed)[0]!.textContent).toBe('Not allowed');
  });

  it('refuses a result that is not a data:image URL', async () => {
    installNative({
      loadRemoteImage: async () => ({ ok: true, value: { dataUrl: 'https://evil.example/x.png' } }),
    });
    const ed = mount(`![x](${URL_})`);
    ed.view.contentDOM.querySelector<HTMLButtonElement>('.cm-image-remote button')!.click();
    await later();
    expect(imgs(ed)).toHaveLength(0);
  });

  it('never offers Load for non-http(s) URLs', () => {
    installNative({ loadRemoteImage: vi.fn() });
    const ed = mount('![a](file:///etc/passwd) ![b](javascript:alert(1)) ![c]()');
    expect(ed.view.contentDOM.querySelector('button')).toBeNull();
  });
});
