// @vitest-environment jsdom
import { syntaxTree } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor } from '../src/editor/createEditor';
import { LARGE_NOTE_HINT } from '../src/editor/extensions';

// Literal on purpose: the requirement is 1,000,000 characters, whatever the source constant says.
const LARGE_DOC_CHARS = 1_000_000;

const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
Range.prototype.getClientRects ??= noRects as never;
Range.prototype.getBoundingClientRect ??= (() => new DOMRect()) as never;

let host: HTMLElement | undefined;
afterEach(() => host?.remove());
const mountDoc = (doc: string) => {
  host = document.createElement('div');
  document.body.append(host);
  return createEditor(host, { doc });
};

describe('large-document guard', () => {
  // One giant paragraph is the worst case for lezer-markdown (a 3 MB one took ~9 s to mount).
  const big =
    '# not a heading here\n' + 'lorem ipsum dolor '.repeat(Math.ceil(LARGE_DOC_CHARS / 18) + 1);

  it('above the threshold: plain text, a visible note, no parser, mounts fast, text is lossless', () => {
    expect(big.length).toBeGreaterThan(LARGE_DOC_CHARS);
    const t0 = performance.now();
    const ed = mountDoc(big);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
    expect(host!.querySelector('.cm-large-note')?.textContent).toBe(LARGE_NOTE_HINT);
    expect(syntaxTree(ed.view.state).length).toBe(0); // nothing was parsed
    expect(host!.querySelector('.cm-lp-h1')).toBeNull(); // no live preview
    expect(ed.getText()).toBe(big);
    ed.destroy();
  });

  it('a normal note has Markdown and no notice; switching documents flips the mode', () => {
    const ed = mountDoc('# Title\n\nsome text');
    expect(host!.querySelector('.cm-large-note')).toBeNull();
    expect(syntaxTree(ed.view.state).length).toBeGreaterThan(0);
    ed.setText(big);
    expect(host!.querySelector('.cm-large-note')).not.toBeNull();
    expect(ed.getText()).toBe(big);
    ed.setText('# Small again');
    expect(host!.querySelector('.cm-large-note')).toBeNull();
    expect(syntaxTree(ed.view.state).length).toBeGreaterThan(0);
    ed.destroy();
  });

  it('exactly at the threshold is still formatted (the guard is "above")', () => {
    const ed = mountDoc('a'.repeat(LARGE_DOC_CHARS));
    expect(host!.querySelector('.cm-large-note')).toBeNull();
    ed.destroy();
  });
});
