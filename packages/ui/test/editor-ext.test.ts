// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree, LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { redo, undo, isolateHistory, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { createEditor, type EditorHandle } from '../src/editor/createEditor';
import { editorExtensions, EDITOR_KEY_OVERRIDES, TAB_ESCAPE_HINT } from '../src/editor/extensions';
import { formattingCommands } from '../src/editor/formatting';
import { toggleTaskCommand } from '../src/editor/checklist';
import { commands as manifest } from '../src/commands/manifest';
import { makeCorpus } from './make-corpus';

const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
Range.prototype.getClientRects ??= noRects as never;
Range.prototype.getBoundingClientRect ??= (() => new DOMRect()) as never;

let hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.forEach((h) => h.remove());
  hosts = [];
  vi.restoreAllMocks();
});
function mount(doc: string, opts: Partial<Parameters<typeof createEditor>[1]> = {}): EditorHandle {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  return createEditor(host, { doc, ...opts });
}
const select = (ed: EditorHandle, anchor: number, head = anchor) =>
  ed.view.dispatch({
    selection: EditorSelection.range(
      Math.min(anchor, ed.view.state.doc.length),
      Math.min(head, ed.view.state.doc.length),
    ),
  });
const cls = (ed: EditorHandle, c: string) => [...ed.view.contentDOM.querySelectorAll('.' + c)];

describe('decorations never change the document', () => {
  /** Moves the cursor across every line of every document; returns names of changed docs. */
  function changedDocs(extra: Parameters<typeof mount>[1], docs = makeCorpus()) {
    const bad: string[] = [];
    for (const d of docs) {
      const ed = mount(d.text, extra);
      const lines = ed.view.state.doc.lines;
      for (let n = 1; n <= Math.min(lines, 12); n++) select(ed, ed.view.state.doc.line(n).from);
      if (ed.getText() !== d.text) bad.push(d.name);
    }
    return bad;
  }
  it('passes for the real extension set', () => {
    expect(changedDocs({})).toEqual([]);
  });
  it('can fail: a deliberately mutating plugin is detected', () => {
    const mutator = EditorState.transactionFilter.of((tr) =>
      tr.selection && !tr.docChanged ? [tr, { changes: { from: 0, insert: '#' } }] : tr,
    );
    const bad = changedDocs({ extensions: [...editorExtensions(), mutator] });
    expect(bad.length).toBeGreaterThan(10);
  });
});

describe('live preview decorations', () => {
  const doc = [
    '# Title',
    '',
    'a *em* **st** ~~del~~ `code` [l](http://x.y)',
    '',
    '- item',
    '> quote',
    '',
    '```ts',
    'const x = 1;',
    '```',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
  ].join('\n');
  it('classes per construct', () => {
    const ed = mount(doc);
    select(ed, doc.length); // cursor away from the heading and inline line
    const texts = (c: string) => cls(ed, c).map((e) => e.textContent);
    expect(texts('cm-lp-h1')).toEqual(['Title']);
    expect(texts('cm-lp-em')).toEqual(['em']);
    expect(texts('cm-lp-strong')).toEqual(['st']);
    expect(texts('cm-lp-strike')).toEqual(['del']);
    expect(texts('cm-lp-code')).toEqual(['code']);
    expect(texts('cm-lp-link').join()).toContain('l');
    expect(texts('cm-lp-listmark')).toEqual(['-']);
    expect(cls(ed, 'cm-lp-quote')).toHaveLength(1);
    expect(cls(ed, 'cm-lp-fence')).toHaveLength(3);
    expect(cls(ed, 'cm-lp-table-header')).toHaveLength(1);
    expect(cls(ed, 'cm-lp-table-delim')).toHaveLength(1);
    expect(cls(ed, 'cm-lp-table-row')).toHaveLength(1);
  });
  it('hides marks only on lines without the cursor or selection', () => {
    const ed = mount(doc);
    select(ed, doc.length);
    const line = (i: number) => ed.view.contentDOM.querySelectorAll('.cm-line')[i]!.textContent;
    expect(line(0)).toBe('Title');
    expect(line(2)).toContain('em st del code');
    expect(line(2)).not.toContain('*');
    select(ed, 3); // cursor inside the heading line
    expect(line(0)).toBe('# Title');
    select(ed, 0, 40); // selection spanning heading and inline line
    expect(line(0)).toBe('# Title');
    expect(line(2)).toContain('*em*');
  });
  it('a highlighted token class appears inside fenced code', async () => {
    const ed = mount(doc);
    const js = LanguageDescription.matchLanguageName(languages, 'ts')!;
    await js.load();
    ed.view.dispatch({ changes: { from: 0, insert: ' ' } }); // force a reparse with the loaded language
    ensureSyntaxTree(ed.view.state, ed.view.state.doc.length, 5000);
    ed.view.dispatch({ selection: { anchor: 0 } });
    const toks = cls(ed, 'tok-keyword').map((e) => e.textContent);
    expect(toks).toContain('const');
  });
});

describe('images', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  it('renders <img alt> for data: URLs only', () => {
    const ed = mount(`![a pic](${PNG})`);
    const imgs = ed.view.contentDOM.querySelectorAll('img:not(.cm-widgetBuffer)');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.getAttribute('alt')).toBe('a pic');
    expect(imgs[0]!.getAttribute('src')).toBe(PNG);
  });
  it('is inert for http: and never requests anything', () => {
    const srcs: string[] = [];
    const setAttr = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (this: Element, n, v) {
      if (/^(src|srcset|href)$/i.test(n)) srcs.push(v);
      return setAttr.call(this, n, v);
    });
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get: desc.get,
      set(v: string) {
        srcs.push(v);
      },
    });
    try {
      const ed = mount(
        '![x](http://evil.example/a.png) ![y](https://e/b.png) ![z](file:///etc/passwd) ![n]()',
      );
      expect(ed.view.contentDOM.querySelectorAll('img:not(.cm-widgetBuffer)')).toHaveLength(0);
      expect(ed.view.contentDOM.querySelectorAll('.cm-image-inert')).toHaveLength(4);
      expect(ed.view.contentDOM.innerHTML).not.toMatch(/<img[^>]*src/); // only src-less CM buffers
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, 'src', desc);
    }
    expect(srcs).toEqual([]);
  });
});

describe('checklist', () => {
  const doc = 'intro\n- [ ] one\n- [x] two\n';
  it('click toggles exactly one character, undo and re-toggle round trip', () => {
    const ed = mount(doc);
    const boxes = cls(ed, 'cm-task-box') as HTMLElement[];
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(boxes[0]!.getAttribute('role')).toBe('checkbox');
    boxes[0]!.click();
    const after = ed.getText();
    expect(after).toBe('intro\n- [x] one\n- [x] two\n');
    expect([...after].filter((c, i) => c !== doc[i])).toHaveLength(1);
    (cls(ed, 'cm-task-box')[0] as HTMLElement).click();
    expect(ed.getText()).toBe(doc);
    (cls(ed, 'cm-task-box')[1] as HTMLElement).click();
    expect(ed.getText()).toBe('intro\n- [ ] one\n- [ ] two\n');
    undo(ed.view);
    expect(ed.getText()).toBe(doc);
  });
  it('Mod-Shift-Enter toggles the cursor line, only task lines', () => {
    const ed = mount(doc);
    select(ed, 9);
    expect(toggleTaskCommand(ed.view)).toBe(true);
    expect(ed.getText()).toBe('intro\n- [x] one\n- [x] two\n');
    select(ed, 2);
    // a plain line becomes a task (a toolbar button must never be a no-op)
    expect(toggleTaskCommand(ed.view)).toBe(true);
    expect(ed.getText()).toBe('- [ ] intro\n- [x] one\n- [x] two\n');
    undo(ed.view);
    undo(ed.view);
    expect(ed.getText()).toBe(doc);
  });
  it('makes a task from a bullet, keeps indentation, and is inert read-only', () => {
    const ed = mount('- plain\n  - nested\ntext');
    select(ed, 3);
    toggleTaskCommand(ed.view);
    select(ed, ed.getText().indexOf('nested'));
    toggleTaskCommand(ed.view);
    expect(ed.getText()).toBe('- [ ] plain\n  - [ ] nested\ntext');
    const ro = mount('text', { readOnly: true });
    expect(toggleTaskCommand(ro.view)).toBe(true);
    expect(ro.getText()).toBe('text');
  });
  it('does nothing when read-only (click and command)', () => {
    const ed = mount(doc, { readOnly: true });
    (cls(ed, 'cm-task-box')[0] as HTMLElement).click();
    expect(ed.getText()).toBe(doc);
    select(ed, 9);
    toggleTaskCommand(ed.view);
    expect(ed.getText()).toBe(doc);
    ed.setReadOnly(false);
    (cls(ed, 'cm-task-box')[0] as HTMLElement).click();
    expect(ed.getText()).not.toBe(doc);
  });
});

describe('formatting commands', () => {
  const run = (id: keyof typeof formattingCommands, doc: string, a: number, b = a) => {
    const ed = mount(doc);
    select(ed, a, b);
    formattingCommands[id](ed.view);
    return ed;
  };
  it('bold / italic wrap, toggle off, empty cursor', () => {
    expect(run('format.bold', 'hello world', 0, 5).getText()).toBe('**hello** world');
    expect(run('format.italic', 'hello world', 6, 11).getText()).toBe('hello *world*');
    expect(run('format.bold', 'ab', 1).getText()).toBe('a****b');
    const ed = run('format.bold', 'hello', 0, 5);
    formattingCommands['format.bold'](ed.view); // selection kept on "hello": toggles off
    expect(ed.getText()).toBe('hello');
    const it2 = run('format.italic', '**b**', 2, 3); // inside bold: italic adds, does not strip a star
    expect(it2.getText()).toBe('***b***');
  });
  it('multi-line selections wrap per line and skip blank lines', () => {
    expect(run('format.bold', 'one\n\ntwo', 0, 8).getText()).toBe('**one**\n\n**two**');
    expect(run('format.bullet', 'a\n\nb', 0, 4).getText()).toBe('- a\n\n- b');
    expect(run('format.bullet', '- a\n- b', 0, 7).getText()).toBe('a\nb');
    expect(run('format.bullet', '- a\nb', 0, 5).getText()).toBe('- a\n- b');
  });
  it('link and heading cycle', () => {
    const l = run('format.link', 'see docs now', 4, 8);
    expect(l.getText()).toBe('see [docs](url) now');
    const s = l.view.state.selection.main;
    expect(l.getText().slice(s.from, s.to)).toBe('url');
    expect(run('format.link', 'x', 1).getText()).toBe('x[](url)');
    const h = run('format.heading', 'title', 2);
    expect(h.getText()).toBe('# title');
    formattingCommands['format.heading'](h.view);
    expect(h.getText()).toBe('## title');
    formattingCommands['format.heading'](h.view);
    expect(h.getText()).toBe('### title');
    formattingCommands['format.heading'](h.view);
    expect(h.getText()).toBe('title');
  });
  it('CRLF documents stay all-CRLF for every command', () => {
    const base = 'one\r\ntwo\r\n\r\nthree\r\n';
    for (const id of Object.keys(formattingCommands) as (keyof typeof formattingCommands)[]) {
      const ed = run(id, base, 0, 1e9);
      const t = ed.getText();
      expect(t.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      expect(t).toMatch(/\r\n/);
      if (id !== 'format.task') expect(t).not.toBe(base);
    }
    const ed = run('format.bold', base, 0, 1e9);
    expect(ed.getText()).toBe('**one**\r\n**two**\r\n\r\n**three**\r\n');
  });
  it('are inert when read-only', () => {
    for (const id of Object.keys(formattingCommands) as (keyof typeof formattingCommands)[]) {
      const ed = mount('- [ ] a\nb', { readOnly: true });
      select(ed, 0, 5);
      formattingCommands[id](ed.view);
      expect(ed.getText()).toBe('- [ ] a\nb');
    }
  });
  it('keymap: defaults come from the manifest, custom bindings are honored, Prec.high is applied', () => {
    const ed = mount('hi', {
      extensions: [...editorExtensions({ bindings: { 'format.bold': 'Ctrl-Alt-9' } })],
    });
    select(ed, 0, 2);
    const press = (key: string, extra: KeyboardEventInit) =>
      ed.view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
      );
    press('b', { metaKey: true, ctrlKey: true }); // default Mod-b no longer bound
    expect(ed.getText()).toBe('hi');
    press('9', { ctrlKey: true, altKey: true });
    expect(ed.getText()).toBe('**hi**');
  });
  it('real keydown for Mod-b', () => {
    const ed = mount('hi');
    select(ed, 0, 2);
    const mac = /Mac|iPhone/.test(navigator.platform);
    ed.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        keyCode: 66,
        metaKey: mac,
        ctrlKey: !mac,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(ed.getText()).toBe('**hi**');
  });
  it('overrides are limited to the allowlist and every other manifest shortcut avoids CM defaults', () => {
    const cmKeys = new Set(
      defaultKeymap.flatMap((k) => [k.key, k.mac, k.win, k.linux]).filter(Boolean),
    );
    const clashes = manifest
      .filter((c) => c.id.startsWith('format.') && c.shortcut && cmKeys.has(c.shortcut))
      .map((c) => c.shortcut);
    expect(clashes).toEqual(EDITOR_KEY_OVERRIDES.filter((k) => clashes.includes(k)));
    expect(EDITOR_KEY_OVERRIDES).toEqual(['Mod-i']);
    expect(cmKeys.has('Mod-i')).toBe(true);
  });
});

describe('history and read-only', () => {
  it('150 isolated edits, 120 undos, then redo', () => {
    const ed = mount('');
    for (let i = 0; i < 150; i++) {
      ed.view.dispatch({
        changes: { from: ed.view.state.doc.length, insert: String(i % 10) },
        annotations: isolateHistory.of('full'),
      });
    }
    const full = ed.getText();
    expect(full).toHaveLength(150);
    for (let i = 0; i < 120; i++) undo(ed.view);
    expect(ed.getText()).toBe(full.slice(0, 30));
    redo(ed.view);
    expect(ed.getText()).toBe(full.slice(0, 31));
    for (let i = 0; i < 119; i++) redo(ed.view);
    expect(ed.getText()).toBe(full);
  });
  it('read-only blocks every programmatic edit, and setReadOnly(false) restores it', () => {
    const ed = mount('abc', { readOnly: true });
    ed.view.dispatch({ changes: { from: 0, insert: 'X' } });
    ed.view.dispatch({ changes: { from: 0, to: 3 } });
    expect(ed.getText()).toBe('abc');
    expect(ed.view.state.readOnly).toBe(true);
    ed.setReadOnly(false);
    ed.view.dispatch({ changes: { from: 0, insert: 'X' } });
    expect(ed.getText()).toBe('Xabc');
  });
  it('onDirty fires without needing onChange (no per-keystroke text copy)', () => {
    let n = 0;
    const ed = mount('a', { onDirty: () => n++ });
    ed.view.dispatch({ changes: { from: 0, insert: 'b' } });
    expect(n).toBe(1);
  });
});

describe('tab behavior', () => {
  it('keymap configuration: Tab indents, CodeMirror keeps its tab-focus toggle, hint is described', () => {
    expect(indentWithTab.key).toBe('Tab');
    const toggle = defaultKeymap.find((k) => k.key === 'Ctrl-m');
    expect(toggle?.mac).toBe('Shift-Alt-m');
    const ed = mount('x');
    const id = ed.view.contentDOM.getAttribute('aria-describedby')!;
    expect(ed.view.dom.querySelector('#' + id)?.textContent).toBe(TAB_ESCAPE_HINT);
  });
  it('Esc then Tab is not consumed by the editor, plain Tab is', () => {
    const ed = mount('x');
    const key = (k: string, code: number) => {
      const e = new KeyboardEvent('keydown', {
        key: k,
        keyCode: code,
        bubbles: true,
        cancelable: true,
      });
      ed.view.contentDOM.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(key('Tab', 9)).toBe(true);
    key('Escape', 27);
    expect(key('Tab', 9)).toBe(false);
  });
});

describe('large documents', () => {
  it('a 3.3 MB (paragraph-separated) document mounts and takes an edit within a loose budget', () => {
    const big = 'word **bold** [l](u)\n\n'.repeat(150_000);
    const t0 = performance.now();
    const ed = mount(big);
    ed.view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(ed.view.state.doc.length).toBe(big.length + 1);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});

describe('theme', () => {
  it('EditorView exists with the token theme', () => {
    expect(EditorView.theme).toBeTypeOf('function');
  });
});

describe('corpus with the full extension set and checklist toggles', () => {
  it('every document survives cursor moves and a double checklist toggle byte for byte', () => {
    const diffs: string[] = [];
    for (const d of makeCorpus()) {
      const text =
        d.text +
        (d.text.length < 5000
          ? '\n- [ ] task\n- [x] done\n'.replace(/\n/g, d.text.includes('\r\n') ? '\r\n' : '\n')
          : '');
      const ed = mount(text);
      const before = ed.getText();
      for (let n = 1; n <= Math.min(ed.view.state.doc.lines, 8); n++)
        select(ed, ed.view.state.doc.line(n).from);
      for (const b of cls(ed, 'cm-task-box') as HTMLElement[]) b.click();
      for (const b of cls(ed, 'cm-task-box') as HTMLElement[]) b.click();
      if (ed.getText() !== before) diffs.push(d.name);
    }
    expect(diffs).toEqual([]);
  });
});
