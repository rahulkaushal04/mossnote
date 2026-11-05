// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { indentMore, indentLess, cursorCharRight } from '@codemirror/commands';
import { Text } from '@codemirror/state';
import axe from 'axe-core';
import { createEditor } from '../src/editor/createEditor';
import { makeCorpus } from './make-corpus';

const bytes = (s: string) => Buffer.from(s, 'utf8');
// jsdom has no layout; CodeMirror's measure pass needs these.
const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
Range.prototype.getClientRects ??= noRects as never;
Range.prototype.getBoundingClientRect ??= (() => new DOMRect()) as never;
let host: HTMLElement | undefined;
afterEach(() => host?.remove());
function mount(doc: string) {
  host = document.createElement('div');
  document.body.append(host);
  return createEditor(host, { doc });
}

describe('corpus', () => {
  const corpus = makeCorpus();
  it('has 200 docs covering the required shapes', () => {
    expect(corpus).toHaveLength(200);
    const all = corpus.map((d) => d.text);
    expect(all.some((t) => t.includes('\r\n'))).toBe(true);
    expect(all.some((t) => t.startsWith('﻿'))).toBe(true);
    expect(all.some((t) => t === '')).toBe(true);
  });

  it('CodeMirror default Text normalizes line endings (documents the discrepancy)', () => {
    const lossy = corpus.filter((d) => Text.of(d.text.split(/\r\n?|\n/)).toString() !== d.text);
    expect(lossy.length).toBeGreaterThan(0); // CRLF and lone CR docs
  });

  it('round-trips every document with 0 byte differences (initial doc and setText)', () => {
    const ed = mount('');
    const diffs: string[] = [];
    for (const d of corpus) {
      ed.setText(d.text);
      if (!bytes(ed.getText()).equals(bytes(d.text))) diffs.push(d.name);
    }
    ed.destroy();
    for (const d of corpus) {
      const e = mount(d.text);
      if (!bytes(e.getText()).equals(bytes(d.text))) diffs.push('init:' + d.name);
      e.destroy();
      host?.remove();
    }
    expect(diffs).toEqual([]);
  });

  it('typing in a CRLF doc keeps CRLF (Enter inserts state.lineBreak)', () => {
    const ed = mount('a\r\nb\r\n');
    ed.view.dispatch({ changes: { from: 0, insert: 'X' } });
    expect(ed.getText()).toBe('Xa\r\nb\r\n');
    ed.view.dispatch({ changes: { from: 1, insert: ed.view.state.lineBreak } }); // what insertNewline uses
    expect(ed.getText()).toBe('X\r\na\r\nb\r\n');
  });
});

describe('keyboard', () => {
  it('Tab (indentMore) / Shift-Tab (indentLess) indent and dedent; arrows move the cursor', () => {
    const ed = mount('line');
    ed.view.dispatch({ selection: EditorSelection.cursor(0) });
    indentMore(ed.view);
    expect(ed.getText()).toBe('  line');
    indentLess(ed.view);
    expect(ed.getText()).toBe('line');
    cursorCharRight(ed.view);
    expect(ed.view.state.selection.main.head).toBe(1);
  });
});

describe('a11y (axe-core in jsdom)', () => {
  it('has no violations on the mounted editor', async () => {
    const ed = mount('# Hello\n');
    const res = await axe.run(host!, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.map((v) => v.id)).toEqual([]);
    ed.destroy();
  });
});
