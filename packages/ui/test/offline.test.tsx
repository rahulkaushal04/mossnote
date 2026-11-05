// @vitest-environment jsdom
// AS-14 / X1 / X2: nothing leaves the machine. Runtime part: every network API and every
// resource-URL attribute write is trapped while the integrated app (real workspace, real
// CodeMirror) runs all flows. Static part: index.html, CSS, sources and the BUILT bundles.
// NOT provable here: Chromium background traffic (DNS prefetch, updater), real file: loading.
// That is tests/e2e/offline.e2e.ts plus the human network spot-check (docs/progress.md).
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import { build } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaptureApp } from '../src/capture/CaptureApp';
import { bootApp, noteOptions, seed, text, treeItem, typeInto, type Booted } from './helpers/app';
import { byText, click, mount, press, waitFor, type Mounted } from './helpers/dom';
import { makeEnv, type Env } from './helpers/workspace';

const UI = join(__dirname, '..');
const SRC = join(UI, 'src');

// ---------- runtime traps ----------
const SAFE_REF = /^(data:image\/|blob:|#|$)/i;
const REF_ATTRS = new Set([
  'src',
  'srcset',
  'href',
  'action',
  'formaction',
  'poster',
  'data',
  'xlink:href',
  'background',
]);
let calls: string[] = [];
let refs: string[] = [];
const undo: (() => void)[] = [];

function patch(obj: object, key: string, value: unknown) {
  const had = Object.getOwnPropertyDescriptor(obj, key);
  Object.defineProperty(obj, key, { value, configurable: true, writable: true });
  undo.push(() => (had ? Object.defineProperty(obj, key, had) : delete (obj as never)[key]));
}
function installTraps() {
  calls = [];
  refs = [];
  const g = globalThis as unknown as Record<string, unknown>;
  const targets = [g, window as unknown as Record<string, unknown>];
  for (const t of new Set(targets)) {
    patch(t, 'fetch', (...a: unknown[]) => {
      calls.push(`fetch ${String(a[0])}`);
      return Promise.reject(new Error('offline test: fetch'));
    });
    class XHR {
      open(...a: unknown[]) {
        calls.push(`XMLHttpRequest.open ${String(a[1])}`);
      }
      send() {
        calls.push('XMLHttpRequest.send');
      }
      setRequestHeader() {}
      addEventListener() {}
    }
    patch(t, 'XMLHttpRequest', XHR);
    for (const name of ['WebSocket', 'EventSource']) {
      patch(
        t,
        name,
        class {
          constructor(url: unknown) {
            calls.push(`new ${name} ${String(url)}`);
          }
        },
      );
    }
    patch(t, 'open', (...a: unknown[]) => void calls.push(`window.open ${String(a[0])}`));
  }
  patch(navigator, 'sendBeacon', (u: unknown) => (calls.push(`sendBeacon ${String(u)}`), false));
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get: srcDesc.get,
    set(v: string) {
      refs.push(`img.src=${v}`);
      srcDesc.set!.call(this, v);
    },
  });
  undo.push(() => Object.defineProperty(HTMLImageElement.prototype, 'src', srcDesc));
  const setAttr = Element.prototype.setAttribute;
  patch(Element.prototype, 'setAttribute', function (this: Element, name: string, value: string) {
    if (REF_ATTRS.has(name.toLowerCase())) refs.push(`${name}=${value}`);
    return setAttr.call(this, name, value);
  });
}
const unsafe = (list: string[]) => list.filter((r) => !SAFE_REF.test(r.slice(r.indexOf('=') + 1)));
/** The DOM as it stands: any resource-URL attribute that is not data:/blob:/#. */
function domRefs(): string[] {
  const out: string[] = [];
  for (const el of document.querySelectorAll('*'))
    for (const a of el.getAttributeNames())
      if (REF_ATTRS.has(a.toLowerCase()))
        out.push(`${el.tagName.toLowerCase()} ${a}=${el.getAttribute(a)}`);
  return out;
}

let env: Env | undefined;
let b: Booted | undefined;
let cap: Mounted | undefined;
beforeEach(installTraps);
afterEach(async () => {
  await cap?.unmount();
  await b?.m.unmount();
  env?.cleanup();
  for (const u of undo.splice(0).reverse()) u();
  cap = b = env = undefined;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PICS = [
  'Pics',
  '',
  `![inline](${PNG})`,
  '',
  '![remote](http://example.com/a.png)',
  '',
  '![secure](https://example.com/b.png)',
  '',
  '[a link](https://example.com/page)',
  '',
  '<img src="http://example.com/raw.png">',
  '',
  'end',
].join('\n');
const cmView = () => EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
const ran = (m: string) => env!.bridge.count(m);

describe('runtime: every flow with the network APIs trapped', () => {
  it('records zero network calls and no remote resource URL across the whole app', async () => {
    env = makeEnv();
    await seed(env, 'Plain note\nsecond line', PICS, 'Spare');
    b = await bootApp(env, { editor: 'real', ready: () => noteOptions().length === 3 });
    const model = b.model();
    const check = (step: string) => {
      expect(calls, `network call during: ${step}`).toEqual([]);
      expect(unsafe(refs), `remote resource during: ${step}`).toEqual([]);
      expect(unsafe(domRefs()), `remote URL in the DOM during: ${step}`).toEqual([]);
    };

    // open notes, including one with data: and http(s): images and links
    await click(noteOptions().find((o) => o.textContent === 'Pics'));
    await waitFor(() => !!document.querySelector('.cm-image'), 'data: image rendered');
    expect(document.querySelectorAll('.cm-image')).toHaveLength(1);
    expect((document.querySelector('.cm-image') as HTMLImageElement).src).toBe(PNG);
    expect(document.querySelectorAll('.cm-image-inert').length).toBeGreaterThanOrEqual(2);
    expect(refs.some((r) => r === `img.src=${PNG}`)).toBe(true); // the trap saw the allowed write
    check('open notes with images');

    // edit + save
    await act(async () =>
      cmView().dispatch({
        changes: { from: cmView().state.doc.length, insert: '\nedited' },
        userEvent: 'input.type',
      }),
    );
    await act(async () => void (await b!.timers.advance(6000)));
    await act(async () => void (await model.hooks.flush?.()));
    await waitFor(() => ran('notes.save') >= 1, 'saved');
    check('edit and save');

    // palette: open, search, create a note, run a theme command
    await press(document.body, 'k', { ctrlKey: true });
    await waitFor(() => !!document.querySelector('input[role=combobox]'), 'palette');
    await typeInto(document.querySelector('input[role=combobox]')!, 'Plain');
    await press(document.querySelector('input[role=combobox]')!, 'Escape');
    await press(document.body, 'k', { ctrlKey: true });
    await typeInto(document.querySelector('input[role=combobox]')!, 'Theme: dark');
    await press(document.querySelector('input[role=combobox]')!, 'Enter');
    await waitFor(() => document.documentElement.dataset.theme === 'dark', 'theme changed');
    expect(ran('prefs.set')).toBeGreaterThanOrEqual(1);
    await press(document.body, 'k', { ctrlKey: true });
    await typeInto(document.querySelector('input[role=combobox]')!, 'New note');
    await press(document.querySelector('input[role=combobox]')!, 'Enter');
    await waitFor(() => ran('notes.create') >= 1, 'created');
    check('palette, theme change, new note');

    // delete, undo
    await click(noteOptions().find((o) => o.textContent === 'Spare'));
    await waitFor(() => model.store.get().openId !== null, 'open');
    const spare = noteOptions().find((o) => o.textContent === 'Spare')!;
    await act(async () => void (await model.actions.deleteNote(spare.dataset.id!, 'Spare')));
    await waitFor(() => !!byText(document.body, 'Undo delete'), 'undo toast');
    await click(byText(document.body, 'Undo delete'));
    await waitFor(() => ran('trash.restore') >= 1, 'undone');
    check('delete and undo');

    // trash view: trash, open read-only, restore
    await act(async () => void (await model.actions.deleteNote(spare.dataset.id!, 'Spare')));
    await click(treeItem('Trash'));
    await waitFor(() => !!byText(document.body, 'Restore'), 'trash rows');
    await click(byText(document.body, 'Open'));
    await waitFor(() => /read-only/.test(text()), 'trashed note open');
    await click(byText(document.body, 'Restore'));
    await waitFor(() => ran('trash.restore') >= 2, 'restored');
    check('trash, open trashed note, restore');

    // folders, tags, focus mode, shortcuts view
    await click(byText(document.body, 'New folder'));
    await waitFor(() => !!document.querySelector('input[aria-label^="Rename folder"]'), 'rename');
    await press(document.querySelector('input[aria-label^="Rename folder"]')!, 'Enter');
    await typeInto(document.querySelector<HTMLInputElement>('label input')!, 'ideas');
    await click(byText(document.body, 'Add tag'));
    await waitFor(() => ran('tags.create') >= 1, 'tag');
    await press(document.body, 'f', { ctrlKey: true, shiftKey: true });
    await press(document.body, 'Escape');
    await press(document.body, 'F1');
    await waitFor(() => /Keyboard shortcuts/.test(text()), 'shortcuts');
    await press(document.body, 'F1');
    check('folders, tags, focus mode, shortcuts');

    // quick capture window
    cap = await mount(<CaptureApp bridge={env.bridge} onClose={() => {}} />);
    const area = document.querySelector<HTMLTextAreaElement>('textarea#capture-text')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        area,
        'captured',
      );
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press(area, 'Enter', { ctrlKey: true });
    await waitFor(() => ran('capture.save') >= 1, 'captured');
    check('quick capture');

    // The traps themselves work: a deliberate remote write IS seen (the test can fail).
    const probe = document.createElement('img');
    probe.setAttribute('src', 'http://example.com/probe.png');
    await fetch('http://example.com/probe').catch(() => undefined);
    expect(calls).toEqual(['fetch http://example.com/probe']);
    expect(unsafe(refs)).toEqual(['src=http://example.com/probe.png']);
  }, 120_000);
});

// ---------- static checks ----------
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
/** XML namespace identifiers, never requested. Anything else needs a reason added HERE. */
const ALLOWED_URL_LITERALS = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/1998/Math/MathML',
  // React's minified-error message prefix: text shown in an Error, never fetched.
  'https://react.dev/errors/',
  // @codemirror/lang-markdown autolink: a bare "https://" prefix test/concatenation on link text.
  'https://',
];
const URL_LITERAL = /\b(?:https?|wss?):\/\/[^\s"'`)<>\\]*/gi;
// Only exact matches, or prefixes that end in a path separator (a bare 'https://' must stay exact).
const allowed = (u: string) =>
  ALLOWED_URL_LITERALS.some((a) => u === a || (a.endsWith('/errors/') && u.startsWith(a)));

/** Remote-URL problems in a piece of built JS/HTML/CSS. */
function scanBuilt(code: string, label: string): string[] {
  const isCss = /\.css$|\.html$/.test(label);
  const out: string[] = [];
  for (const m of code.matchAll(URL_LITERAL))
    if (!allowed(m[0])) out.push(`${label}: URL literal ${m[0].slice(0, 60)}`);
  const bad: [RegExp, string][] = [
    [/\bfetch\(\s*[`"']\s*(?:https?|wss?):/g, 'fetch of a remote URL'],
    [/\bimport\(\s*[`"']\s*(?:https?):/g, 'dynamic import of a remote URL'],
    [/new\s+(?:WebSocket|EventSource)\s*\(/g, 'WebSocket/EventSource'],
    [/\bXMLHttpRequest\b/g, 'XMLHttpRequest'],
    [/\bsendBeacon\b/g, 'sendBeacon'],
    [/\.src\s*=\s*[`"']\s*https?:/g, 'remote .src assignment'],
    [/url\(\s*['"]?\s*(?:https?:|\/\/)/gi, 'remote url()'],
  ];
  // JS bundles contain the words "@import"/"@font-face" as CSS-language keyword tables, so those are checked in .css/.html only.
  if (isCss) bad.push([/@import\b/g, '@import'], [/@font-face/g, '@font-face']);
  for (const [re, what] of bad) if (re.test(code)) out.push(`${label}: ${what}`);
  // Any other fetch( must be Vite's modulepreload polyfill, which returns early where the browser
  // supports <link rel=modulepreload> natively (Chromium does) and only ever reads same-origin hrefs.
  for (const m of code.matchAll(/\bfetch\(/g)) {
    const around = code.slice(Math.max(0, m.index! - 1200), m.index! + 40);
    if (!/supports\(`modulepreload`\)\)return/.test(around) || !/fetch\(e\.href,/.test(around))
      out.push(`${label}: unexplained fetch( call`);
  }
  return out;
}

describe('static: nothing remote in the sources', () => {
  it('index.html has no http(s):// and no external script, link or font', () => {
    const html = readFileSync(join(UI, 'index.html'), 'utf8');
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(
      /<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)="(?!\/src\/|data:|#)/i,
    );
  });
  it('ui CSS has no http(s)://, url(), @import or @font-face', () => {
    const css = walk(SRC).filter((f) => f.endsWith('.css'));
    expect(css.length).toBeGreaterThanOrEqual(3);
    for (const f of css) {
      const t = readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/https?:\/\//i);
      expect(t, f).not.toMatch(/url\(/i);
      expect(t, f).not.toMatch(/@import/i);
      expect(t, f).not.toMatch(/@font-face/i);
    }
  });
  it('ui sources contain no URL literal outside the documented allowlist', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC).filter((x) => /\.(tsx?|css)$/.test(x))) {
      const t = readFileSync(f, 'utf8');
      for (const m of t.matchAll(URL_LITERAL))
        if (!allowed(m[0])) offenders.push(`${f.slice(SRC.length)}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('static: the production bundle', () => {
  it('scanBuilt can fail: each forbidden shape is reported', () => {
    expect(scanBuilt('fetch("https://evil.example/x")', 'x')).not.toEqual([]);
    expect(scanBuilt('new WebSocket("wss://a.b")', 'x')).not.toEqual([]);
    expect(scanBuilt('a.src="https://cdn.x/y.png"', 'x')).not.toEqual([]);
    expect(scanBuilt('b{background:url(https://x/y.png)}', 'x')).not.toEqual([]);
    expect(scanBuilt('import("https://cdn/x.js")', 'x')).not.toEqual([]);
    expect(scanBuilt('navigator.sendBeacon(u)', 'x')).not.toEqual([]);
    expect(scanBuilt('const u="https://tracker.example/p"', 'x')).not.toEqual([]);
    expect(scanBuilt('fetch(url)', 'x')).not.toEqual([]); // an unexplained fetch
    expect(scanBuilt('@import "x.css"', 'a.css')).not.toEqual([]);
    expect(scanBuilt('const ns="http://www.w3.org/2000/svg"', 'x')).toEqual([]);
  });

  it('a fresh production build (and packages/ui/dist, when present) is clean', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mossnote-offline-'));
    try {
      // vitest sets NODE_ENV=test, which would bundle React's development build (extra doc URLs).
      const env0 = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await build({
          root: UI,
          mode: 'production',
          logLevel: 'silent',
          build: { outDir: out, emptyOutDir: true, write: true },
        });
      } finally {
        process.env.NODE_ENV = env0;
      }
      const dirs = [out];
      const dist = join(UI, 'dist');
      try {
        if (statSync(dist).isDirectory()) dirs.push(dist);
      } catch {
        // No dist yet: the fresh build above is the check. Not skipped, just the other copy.
      }
      const problems: string[] = [];
      let scanned = 0;
      for (const d of dirs)
        for (const f of walk(d).filter((x) => /\.(js|css|html)$/.test(x))) {
          scanned++;
          problems.push(...scanBuilt(readFileSync(f, 'utf8'), f.slice(d.length)));
        }
      expect(scanned).toBeGreaterThan(10);
      expect(problems).toEqual([]);
      // The Vite modulepreload polyfill really is the only fetch, and it is guarded (see scanBuilt).
      const main = walk(out).find((f) => /assets\/index-.*\.js$/.test(f))!;
      expect(readFileSync(main, 'utf8').match(/\bfetch\(/g)?.length ?? 0).toBeLessThanOrEqual(1);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
